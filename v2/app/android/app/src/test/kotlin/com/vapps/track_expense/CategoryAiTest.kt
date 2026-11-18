package com.vapps.track_expense

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

/** D-032: category suggestions from Cloud, Gemma or Nano, always waiting for approval. */
class CategoryAiTest {
    private val categories = listOf(
        CategoryOption("food", "Food", "expense"),
        CategoryOption("transportation", "Transportation", "expense"),
        CategoryOption("salary", "Salary", "income"),
    )
    private val table = CategoryTable.decode(
        """{"homeId":"h1","userId":"u1","firebase":{"apiKey":"k","appId":"a","projectId":"p","messagingSenderId":"1"},
           "history":{},"builtin":[],"categories":[
             {"id":"food","name":"Food","type":"expense"},{"id":"transportation","name":"Transportation","type":"expense"},
             {"id":"salary","name":"Salary","type":"income"}]}""",
    )

    private fun item(id: String = "r1", merchant: String? = "BLUE TOKAI COFFEE", words: String? = null, categoryId: String? = null, source: String? = null, type: String = "expense") =
        ReviewItem(id, 420.0, type, merchant, "HDFC XX1234", 1_000L, categoryId, source, "hash1", words)

    /** Answers from a fixed list and records what it was asked. */
    private class FakeSuggester(private val answers: List<String?>, override val model: String? = "Gemini Flash-Lite") : CategorySuggester {
        val asked = mutableListOf<SuggestItem>()
        override suspend fun suggest(items: List<SuggestItem>, categories: List<CategoryOption>): List<String?> {
            asked += items
            return items.indices.map { answers.getOrNull(it) }
        }
    }

    // ------------------------------------------------------------ setting and choice

    @Test
    fun settingDefaultsToOffAndCloudToFlashLite() {
        assertEquals(AiMode.OFF, AiMode.fromWire(null))
        assertEquals(AiMode.OFF, AiMode.fromWire("something"))
        assertEquals(AiMode.GEMMA, AiMode.fromWire("gemma"))
        assertEquals("flash-lite", CloudModel.clean(null))
        assertEquals("flash-lite", CloudModel.clean("vertexai/gemini"))
        assertEquals("flash", CloudModel.clean("flash"))
        assertEquals("Gemini Flash", CloudModel.label("flash"))
    }

    @Test
    fun theSettingOnlyRunsWhatCanRunNow() {
        // Cloud needs a signed-in phone; Gemma a verified file; Nano the foreground.
        assertEquals(AiMode.CLOUD, Suggesters.effective(AiMode.CLOUD, foreground = false, canCloud = true, gemmaReady = false))
        assertEquals(AiMode.OFF, Suggesters.effective(AiMode.CLOUD, foreground = true, canCloud = false, gemmaReady = true))
        assertEquals(AiMode.GEMMA, Suggesters.effective(AiMode.GEMMA, foreground = false, canCloud = false, gemmaReady = true))
        assertEquals(AiMode.OFF, Suggesters.effective(AiMode.GEMMA, foreground = true, canCloud = true, gemmaReady = false))
        assertEquals(AiMode.NANO, Suggesters.effective(AiMode.NANO, foreground = true, canCloud = false, gemmaReady = false))
        assertEquals(AiMode.OFF, Suggesters.effective(AiMode.NANO, foreground = false, canCloud = true, gemmaReady = true))
        assertEquals(AiMode.OFF, Suggesters.effective(AiMode.OFF, foreground = true, canCloud = true, gemmaReady = true))
    }

    // ------------------------------------------------------------ what is sent

    @Test
    fun onlyThePayeeOrTheReplyWordsAreAskedAbout() {
        assertEquals(SuggestItem("BLUE TOKAI COFFEE", "expense", false), SuggestItem.of(item()))
        assertEquals(SuggestItem("auto to office", "expense", true), SuggestItem.of(item(words = " auto to office ")))
        // A phone-number payee says nothing about the payment and is never sent.
        assertNull(SuggestItem.of(item(merchant = "UPI xxxxx3210")))
        assertEquals(SuggestItem("gift", "expense", true), SuggestItem.of(item(merchant = "UPI xxxxx3210", words = "gift")))
        assertNull(SuggestItem.of(item(merchant = null)))
        assertEquals(80, SuggestItem.of(item(merchant = "x".repeat(200)))!!.text.length)
    }

    @Test
    fun candidatesAreUnplacedPayeesAndUnclearWordsAtMostFive() {
        val items = listOf(
            item("a"), item("b", categoryId = "food", source = "builtin"), item("c", merchant = "UPI xxxxx1"),
            item("d", words = "gift for amma", categoryId = "food", source = "builtin"),
            item("e", categoryId = "food", source = ReviewItem.AI_SOURCE),
        ) + (1..6).map { item("x$it") }
        assertEquals(listOf("a", "d", "x1", "x2", "x3"), AiSuggest.candidates(items).map { it.id })
    }

    // ------------------------------------------------------------ suggestions wait for approval

    @Test
    fun answersBecomeAiSuggestionsWithTheModelName() = runBlocking {
        val fake = FakeSuggester(listOf("food", null))
        val out = AiSuggest.apply(listOf(item("a"), item("b", merchant = "Zoo"), item("c", merchant = "UPI xxxxx1")), categories, fake)
        assertEquals(listOf("BLUE TOKAI COFFEE", "Zoo"), fake.asked.map { it.text })
        assertEquals("food", out[0].categoryId)
        assertEquals(ReviewItem.AI_SOURCE, out[0].categorySource)
        assertEquals("Gemini Flash-Lite", out[0].aiModel)
        assertTrue(out[0].isAiSuggestion)
        assertNull(out[1].categoryId)
        assertFalse(out[1].isAiSuggestion)
        assertEquals(item("c", merchant = "UPI xxxxx1"), out[2])
    }

    @Test
    fun offMeansNothingIsAsked() = runBlocking {
        val items = listOf(item())
        assertEquals(items, AiSuggest.apply(items, categories, NoSuggester))
        assertEquals(listOf<String?>(null), NoSuggester.suggest(listOf(SuggestItem("x", "expense", false)), categories))
    }

    @Test
    fun cloudAnswersAreCheckedAgainOnThePhone() {
        val items = listOf(SuggestItem("a", "expense", false), SuggestItem("b", "income", false), SuggestItem("c", "expense", true))
        assertEquals(listOf("food", null, null), SuggestCheck.keep(listOf("food", "food", "made-up"), items, categories))
        assertEquals(listOf<String?>(null, null, null), SuggestCheck.keep(emptyList(), items, categories))
    }

    @Test
    fun approvingIsAUserConfirmedSaveWithoutTheAutoMarker() {
        val ai = item(categoryId = "food", source = ReviewItem.AI_SOURCE).copy(aiModel = "Gemma 3 1B")
        // Approve sends the AI's category as the user's own pick.
        val outcome = LabelLogic.decide(table, ai, "food", null) as LabelOutcome.Save
        assertEquals("food", outcome.categoryId)
        assertEquals("BLUE TOKAI COFFEE · HDFC XX1234", outcome.note)
        assertFalse(SmsEntryWriter.fields(table, 420.0, "expense", "food", outcome.note, SmsSave.NOTIFICATION_ANSWER).containsKey("autoAdded"))
        // The worker's rules never treat an AI guess as confident: no payee memory, no rules → review.
        val sms = ParsedSms(420.0, "expense", "BLUE TOKAI COFFEE", MerchantKey.of("BLUE TOKAI COFFEE"), "HDFC", "1234", "ref", true, payeeHash = "hash1")
        assertTrue(SmsCategoriser.decide(table, sms, null) is Decision.Review)
    }

    @Test
    fun reviewItemsKeepTheModelAndOldNanoSuggestionsCountAsAi() {
        val ai = item(categoryId = "food", source = ReviewItem.AI_SOURCE).copy(aiModel = "Gemini Flash")
        val back = ReviewItem.fromJson(JSONObject(ai.toJson().toString()))
        assertEquals(ai, back)
        assertEquals("Gemini Flash", back.toMap()["aiModel"])
        val nano = item(categoryId = "food", source = "nano")
        assertTrue(nano.isAiSuggestion)
        assertEquals("Gemini Nano", nano.toMap()["aiModel"])
        assertFalse(item(categoryId = "food", source = "builtin").isAiSuggestion)
        assertFalse(item(source = ReviewItem.AI_SOURCE).isAiSuggestion) // no category, nothing to approve
        val updated = ReviewQueueCodec.update(listOf(item()), "r1", "food", ReviewItem.AI_SOURCE, "Gemma 3 1B").single()
        assertEquals("Gemma 3 1B", updated.aiModel)
    }

    // ------------------------------------------------------------ on-device prompt and answer check

    @Test
    fun promptForWordsAndAnswersByIdOrName() {
        val p = NanoPrompt.build("auto to office", "expense", categories, words = true)
        assertTrue(p.contains("The user said it was for: auto to office"))
        assertTrue(p.contains("Categories: food, transportation"))
        assertFalse(p.contains("salary"))
        assertTrue(NanoPrompt.build("BLUE TOKAI", "expense", categories).contains("Payee: BLUE TOKAI"))
        assertEquals("food", NanoPrompt.parse("Food", "expense", categories))
        assertEquals("food", NanoPrompt.parse("**food**\n", "expense", categories))
        assertEquals("transportation", NanoPrompt.parse("Category: Transportation.", "expense", categories))
        assertNull(NanoPrompt.parse("Salary", "expense", categories))
        assertNull(NanoPrompt.parse("I think it is food", "expense", categories))
        assertNull(NanoPrompt.parse("none", "expense", categories))
    }

    @Test
    fun gemmaSuggesterChecksAnswersAndFallsBackWhenTheModelCannotRun() = runBlocking {
        val items = listOf(SuggestItem("BLUE TOKAI", "expense", false), SuggestItem("ACME", "income", false), SuggestItem("auto", "expense", true))
        val prompts = mutableListOf<String>()
        val answered = GemmaSuggester { p -> prompts += p; listOf("Food", "food", "nonsense") }
        assertEquals(listOf("food", null, null), answered.suggest(items, categories))
        assertTrue(prompts[2].contains("The user said it was for: auto"))
        assertEquals("Gemma 3 1B", answered.model)
        // Not enough memory, no file, an error or too slow: no suggestion, no exception.
        assertEquals(listOf<String?>(null, null, null), GemmaSuggester { null }.suggest(items, categories))
    }

    @Test
    fun memoryGate() {
        val gb = 1024L * 1024 * 1024
        assertTrue(MemoryGate.enough(8 * gb, 2 * gb, false))
        assertFalse(MemoryGate.enough(8 * gb, 2 * gb, true))
        assertFalse(MemoryGate.enough(3 * gb, 2 * gb, false))
        assertFalse(MemoryGate.enough(8 * gb, gb / 2, false))
    }

    // ------------------------------------------------------------ notification wording

    @Test
    fun aiNotificationWording() {
        assertEquals("₹420 to BLUE TOKAI — AI suggests Food", SmsNotifications.aiTitle(420.0, "expense", "BLUE TOKAI", null, "Food"))
        assertEquals("₹420 for 'gift for amma' — AI suggests Gifts", SmsNotifications.aiTitle(420.0, "expense", null, "gift for amma", "Gifts"))
        assertEquals("₹5,000 from ACME — AI suggests Salary", SmsNotifications.aiTitle(5000.0, "income", "ACME", null, "Salary"))
        assertEquals("Suggested by AI · Gemma 3 1B · HDFC XX1234. Approve, change or reply.", SmsNotifications.aiText("Gemma 3 1B", "HDFC XX1234"))
        val q = SmsNotifications.formQuery(item(categoryId = "food", source = ReviewItem.AI_SOURCE))
        assertEquals("food", q["category"])
        assertEquals("r1", q["review"])
        assertEquals("1970-01-01T00:00:01Z", q["date"])
        assertEquals("sms", q["source"])
    }

    // ------------------------------------------------------------ download

    @Test
    fun manifestIsCheckedBeforeAnyDownload() {
        val sha = "a".repeat(64)
        assertEquals(ModelManifest("models/g.litertlm", 10, sha), ModelManifest.parse("""{"file":"models/g.litertlm","size":10,"sha256":"$sha"}"""))
        assertNull(ModelManifest.parse("""{"file":"other/g","size":10,"sha256":"$sha"}"""))
        assertNull(ModelManifest.parse("""{"file":"models/../x","size":10,"sha256":"$sha"}"""))
        assertNull(ModelManifest.parse("""{"file":"models/g","size":0,"sha256":"$sha"}"""))
        assertNull(ModelManifest.parse("""{"file":"models/g","size":10,"sha256":"abc"}"""))
        assertNull(ModelManifest.parse("not json"))
        assertNull(ModelManifest.parse(null))
    }

    @Test
    fun downloadStates() {
        // Ready wins; a queued job on mobile data waits for Wi-Fi.
        assertEquals(GemmaStatus.READY, GemmaStatus.describe(GemmaStatus.FAILED, ready = true, workActive = false, metered = true))
        assertEquals(GemmaStatus.WAITING_FOR_WIFI, GemmaStatus.describe(GemmaStatus.QUEUED, ready = false, workActive = true, metered = true))
        assertEquals(GemmaStatus.QUEUED, GemmaStatus.describe(GemmaStatus.QUEUED, ready = false, workActive = true, metered = false))
        assertEquals(GemmaStatus.DOWNLOADING, GemmaStatus.describe(GemmaStatus.DOWNLOADING, ready = false, workActive = true, metered = false))
        assertEquals(GemmaStatus.WAITING_FOR_WIFI, GemmaStatus.describe(GemmaStatus.DOWNLOADING, ready = false, workActive = true, metered = true))
        // A job that ended without finishing (cancelled, killed) is "not downloaded"; final errors stay.
        assertEquals(GemmaStatus.NOT_DOWNLOADED, GemmaStatus.describe(GemmaStatus.DOWNLOADING, ready = false, workActive = false, metered = false))
        assertEquals(GemmaStatus.NOT_DOWNLOADED, GemmaStatus.describe(null, ready = false, workActive = false, metered = false))
        assertEquals(GemmaStatus.NOT_AVAILABLE, GemmaStatus.describe(GemmaStatus.NOT_AVAILABLE, ready = false, workActive = false, metered = false))
        assertEquals(GemmaStatus.NO_SPACE, GemmaStatus.describe(GemmaStatus.NO_SPACE, ready = false, workActive = false, metered = false))
        assertEquals(GemmaStatus.FAILED, GemmaStatus.describe(GemmaStatus.FAILED, ready = false, workActive = false, metered = false))
    }

    @Test
    fun storageUrlEncodesThePath() {
        assertEquals(
            "https://firebasestorage.googleapis.com/v0/b/p.firebasestorage.app/o/models%2Fgemma3-1b-it-int4.json?alt=media",
            ModelDownloader.storageUrl("p.firebasestorage.app", "models/gemma3-1b-it-int4.json"),
        )
    }

    private var server: java.net.ServerSocket? = null
    private val dir: File = Files.createTempDirectory("model").toFile()

    @After
    fun tearDown() {
        server?.close()
        dir.deleteRecursively()
    }

    /**
     * A minimal local HTTP server for [body] (plain sockets; the JVM test
     * classpath is android.jar). Honours Range unless [ranges] is false.
     * Records the Authorization and Range headers of each request.
     */
    private fun serve(body: ByteArray, ranges: Boolean = true, status: Int = 200): Pair<String, MutableList<String>> {
        val seen = java.util.Collections.synchronizedList(mutableListOf<String>())
        val socket = java.net.ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
        server = socket
        Thread {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                client.use { c ->
                    val reader = c.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                    val headers = generateSequence { reader.readLine() }.takeWhile { it.isNotEmpty() }.drop(1)
                        .associate { it.substringBefore(":").trim().lowercase() to it.substringAfter(":").trim() }
                    seen += "${headers["authorization"]}|${headers["range"]}"
                    val range = headers["range"]?.removePrefix("bytes=")?.removeSuffix("-")?.toIntOrNull()
                    val out = c.getOutputStream()
                    fun respond(code: Int, bytes: ByteArray) {
                        out.write("HTTP/1.1 $code X\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        try { out.write(bytes); out.flush() } catch (_: Exception) {}
                    }
                    when {
                        status != 200 -> respond(status, ByteArray(0))
                        ranges && range != null -> respond(206, body.copyOfRange(range, body.size))
                        else -> respond(200, body)
                    }
                }
            }
        }.apply { isDaemon = true }.start()
        return "http://127.0.0.1:${socket.localPort}/model" to seen
    }

    private val body = ByteArray(3_000_000) { (it % 251).toByte() }
    private val sha = MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }

    @Test
    fun downloadsWithTheTokenAndChecksTheHash() {
        val (url, seen) = serve(body)
        val part = File(dir, "m.part")
        val progress = mutableListOf<Long>()
        assertEquals(body.size.toLong(), ModelDownloader.download(url, mapOf("Authorization" to "Firebase t"), part, body.size.toLong(), { progress += it }))
        assertEquals(sha, ModelDownloader.sha256(part))
        assertEquals(listOf("Firebase t|null"), seen)
        assertEquals(body.size.toLong(), progress.last())
        // Already complete: nothing is fetched again.
        ModelDownloader.download(url, emptyMap(), part, body.size.toLong())
        assertEquals(1, seen.size)
    }

    @Test
    fun aStoppedDownloadResumesWithARangeRequest() {
        val (url, seen) = serve(body)
        val part = File(dir, "m.part")
        var reads = 0
        ModelDownloader.download(url, emptyMap(), part, body.size.toLong(), stopped = { reads++ > 3 })
        val partial = part.length()
        assertTrue(partial in 1 until body.size)
        ModelDownloader.download(url, emptyMap(), part, body.size.toLong())
        assertEquals("null|bytes=$partial-", seen.last())
        assertEquals(sha, ModelDownloader.sha256(part))
    }

    @Test
    fun aServerWithoutRangesStartsAgainAndErrorsAreReported() {
        val (url, _) = serve(body, ranges = false)
        val part = File(dir, "m.part")
        part.writeBytes(ByteArray(1000) { 7 }) // stale bytes that are not the file's start
        ModelDownloader.download(url, emptyMap(), part, body.size.toLong())
        assertEquals(sha, ModelDownloader.sha256(part))

        server?.close()
        val (missing, _) = serve(body, status = 404)
        try {
            ModelDownloader.download(missing, emptyMap(), File(dir, "x.part"), 10)
            fail("expected 404")
        } catch (e: ModelDownloader.HttpStatus) {
            assertEquals(404, e.code)
        }
        try {
            ModelDownloader.fetchText(missing, emptyMap())
            fail("expected 404")
        } catch (e: ModelDownloader.HttpStatus) {
            assertEquals(404, e.code)
        }
    }

    @Test
    fun aLargerFileThanTheManifestSaysIsRejected() {
        val (url, _) = serve(body)
        try {
            ModelDownloader.download(url, emptyMap(), File(dir, "m.part"), 1000)
            fail("expected too large")
        } catch (_: java.io.IOException) {
        }
    }
}
