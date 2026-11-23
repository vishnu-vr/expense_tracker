import { FieldValue, Firestore } from "firebase-admin/firestore";
import { AgentBackend } from "../agent/backend";
import { ProposalDraft } from "../core/proposals";
import { HomeData } from "../core/types";
import { loadHomeData, ResolvedHome } from "./home";

export type QueryEmbedder = (text: string) => Promise<number[]>;

/**
 * Tool backend bound to ONE household — the one resolved from the caller's
 * uid before this object is created. No method takes a home id.
 */
export class FirestoreAgentBackend implements AgentBackend {
  private data: Promise<HomeData> | null = null;

  constructor(
    private readonly db: Firestore,
    readonly uid: string,
    private readonly home: ResolvedHome,
    private readonly threadId: string,
    private readonly timeZone: string,
    private readonly embedQuery: QueryEmbedder,
  ) {}

  loadData(): Promise<HomeData> {
    if (!this.data) this.data = loadHomeData(this.db, this.home, this.timeZone);
    return this.data;
  }

  async searchNotes(query: string, limit: number): Promise<{ transactionId: string; score: number }[]> {
    return searchEmbeddings(this.db, this.home.homeId, await this.embedQuery(query), limit);
  }

  async createProposal(draft: ProposalDraft): Promise<string> {
    const ref = this.db
      .collection("homes")
      .doc(this.home.homeId)
      .collection("aiThreads")
      .doc(this.threadId)
      .collection("proposals")
      .doc();
    await ref.set({
      action: draft.action,
      params: draft.params,
      summary: draft.summary,
      status: "pending",
      createdBy: this.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
  }
}

/**
 * Nearest-neighbour search over `transactionEmbeddings`, always pre-filtered
 * by `homeId` (needs the composite vector index in firestore.indexes.json).
 */
export async function searchEmbeddings(
  db: Firestore,
  homeId: string,
  queryVector: number[],
  limit: number,
): Promise<{ transactionId: string; score: number }[]> {
  const snap = await db
    .collection("transactionEmbeddings")
    .where("homeId", "==", homeId)
    .findNearest({
      vectorField: "vector",
      queryVector: FieldValue.vector(queryVector),
      limit,
      distanceMeasure: "COSINE",
      distanceResultField: "distance",
    })
    .get();
  return snap.docs.map((doc) => ({
    transactionId: doc.id,
    score: 1 - Number(doc.get("distance") ?? 1),
  }));
}
