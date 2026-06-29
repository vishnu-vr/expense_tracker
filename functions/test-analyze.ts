/**
 * Simple test script for analyzeTransactions
 * 
 * Usage: npx ts-node test-analyze.ts "Your question here"
 */

// Set credentials FIRST
process.env.GOOGLE_APPLICATION_CREDENTIALS = './service-account.json';
process.env.GCLOUD_PROJECT = 'expense-tracker-e7ff7';

async function main() {
    try {
        console.log('🚀 Starting test...\n');
        
        // Import after setting env vars
        const { initializeApp, cert } = await import('firebase-admin/app');
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        const { genkit } = await import('genkit');
        const { vertexAI } = await import('@genkit-ai/google-genai');
        
        // Load service account
        const serviceAccount = require('./service-account.json');
        console.log(`📁 Using project: ${serviceAccount.project_id}\n`);
        
        // Initialize Firebase
        initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.project_id,
        });
        
        const firestore = getFirestore();
        
        // Initialize Genkit
        const ai = genkit({
            plugins: [vertexAI({ 
                location: 'us-central1',
                projectId: serviceAccount.project_id,
            })],
        });
        
        // Get question from command line
        const question = process.argv.slice(2).join(' ') || 'What are my recent expenses?';
        console.log(`❓ Question: "${question}"\n`);
        
        // Step 1: Check if we have transactions with embeddings
        console.log('📊 Checking transactions...');
        const sampleDocs = await firestore.collection('transactions').limit(3).get();
        console.log(`   Found ${sampleDocs.size} sample transactions`);
        
        if (sampleDocs.size > 0) {
            const firstDoc = sampleDocs.docs[0].data();
            console.log(`   First doc has embedding: ${!!firstDoc.embedding}`);
            if (firstDoc.embedding) {
                console.log(`   Embedding length: ${firstDoc.embedding.length || 'unknown'}`);
            }
        }
        console.log('');
        
        // Step 2: Generate embedding for the question
        console.log('🔤 Generating question embedding...');
        const questionEmbedding = await ai.embed({
            embedder: vertexAI.embedder('text-embedding-004'),
            content: question,
        });
        console.log(`   ✅ Generated embedding with ${questionEmbedding[0].embedding.length} dimensions\n`);
        
        // Get current date for context
        const now = new Date();
        const currentDate = now.toISOString().split('T')[0];
        const currentMonth = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthName = lastMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        
        console.log(`📅 Current date: ${currentDate}`);
        console.log(`📅 Current month: ${currentMonth}`);
        console.log(`📅 Last month: ${lastMonthName}\n`);
        
        // Parse date range from question
        function getDateRange(q: string): { start: Date; end: Date } | null {
            const lq = q.toLowerCase();
            if (lq.includes('last month')) {
                const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
                return { start, end };
            }
            if (lq.includes('this month')) {
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
                return { start, end };
            }
            if (lq.includes('last week')) {
                const start = new Date(now);
                start.setDate(now.getDate() - 7);
                start.setHours(0, 0, 0, 0);
                return { start, end: now };
            }
            return null;
        }
        
        const dateRange = getDateRange(question);
        const timeKeywords = ['last month', 'this month', 'yesterday', 'today', 'last week', 'this week', 'recent', 'lately'];
        const isTimeQuery = timeKeywords.some(kw => question.toLowerCase().includes(kw));
        
        let transactionsContext = '';
        const collection = firestore.collection('transactions');
        
        if (dateRange) {
            console.log(`🕐 Time-based query detected - fetching transactions for specific period...`);
            console.log(`   Date range: ${dateRange.start.toISOString().split('T')[0]} to ${dateRange.end.toISOString().split('T')[0]}`);
            
            const periodSnapshot = await collection
                .where('date', '>=', dateRange.start.toISOString())
                .where('date', '<=', dateRange.end.toISOString())
                .orderBy('date', 'desc')
                .get();
            
            console.log(`   ✅ Found ${periodSnapshot.size} transactions in this period\n`);
            
            console.log('📋 Period transactions:');
            console.log('─'.repeat(60));
            
            transactionsContext = periodSnapshot.docs.map((doc, i) => {
                const data = doc.data();
                const dateStr = data.date?.toDate ? data.date.toDate().toISOString().split('T')[0] : 
                               (typeof data.date === 'string' ? new Date(data.date).toISOString().split('T')[0] : 'N/A');
                const line = `Date: ${dateStr}, Amount: ${data.amount || 'N/A'}, Category: ${data.categoryId || 'N/A'}, Note: ${data.note || 'N/A'}`;
                if (i < 15) console.log(line);
                return line;
            }).join('\n');
            
            if (periodSnapshot.size > 15) console.log(`... and ${periodSnapshot.size - 15} more`);
            if (periodSnapshot.size === 0) transactionsContext = 'No transactions found for this time period.';
        } else if (isTimeQuery) {
            console.log('🕐 General time query - fetching recent transactions...');
            const recentSnapshot = await collection.orderBy('date', 'desc').limit(200).get();
            console.log(`   ✅ Found ${recentSnapshot.size} recent transactions\n`);
            
            console.log('📋 Recent transactions:');
            console.log('─'.repeat(60));
            
            transactionsContext = recentSnapshot.docs.map((doc, i) => {
                const data = doc.data();
                const dateStr = data.date?.toDate ? data.date.toDate().toISOString().split('T')[0] : 
                               (typeof data.date === 'string' ? new Date(data.date).toISOString().split('T')[0] : 'N/A');
                const line = `Date: ${dateStr}, Amount: ${data.amount || 'N/A'}, Category: ${data.categoryId || 'N/A'}, Note: ${data.note || 'N/A'}`;
                if (i < 10) console.log(line);
                return line;
            }).join('\n');
            
            if (recentSnapshot.size > 10) console.log(`... and ${recentSnapshot.size - 10} more`);
        } else {
            console.log('🔍 Semantic query - performing vector search...');
            const vectorQuery = collection.findNearest(
                'embedding',
                FieldValue.vector(questionEmbedding[0].embedding),
                {
                    limit: 20,
                    distanceMeasure: 'COSINE',
                }
            );
            
            const querySnapshot = await vectorQuery.get();
            console.log(`   ✅ Found ${querySnapshot.size} relevant transactions\n`);
            
            if (querySnapshot.size === 0) {
                console.log('⚠️  No transactions found with embeddings. Run backfill first.');
                process.exit(1);
            }
            
            console.log('📋 Retrieved transactions:');
            console.log('─'.repeat(60));
            
            transactionsContext = querySnapshot.docs.map((doc, i) => {
                const data = doc.data();
                const dateStr = data.date?.toDate ? data.date.toDate().toISOString().split('T')[0] : 
                               (typeof data.date === 'string' ? new Date(data.date).toISOString().split('T')[0] : 'N/A');
                const line = `Date: ${dateStr}, Amount: ${data.amount || 'N/A'}, Category: ${data.categoryId || 'N/A'}, Note: ${data.note || 'N/A'}`;
                console.log(line);
                return line;
            }).join('\n');
        }
        
        console.log('─'.repeat(60));
        console.log('');
        
        // Step 5: Generate answer with Gemini
        console.log('🤖 Generating answer with Gemini...\n');
        
        const prompt = `You are a helpful and friendly financial assistant analyzing personal expense data.

CURRENT DATE: ${currentDate}
CURRENT MONTH: ${currentMonth}
LAST MONTH: ${lastMonthName}

USER QUESTION: ${question}

TRANSACTION DATA:
${transactionsContext}

INSTRUCTIONS:
1. Use the current date to correctly interpret relative time references (e.g., "last month" = ${lastMonthName})
2. Filter the transactions based on the time period mentioned in the question
3. Calculate totals, averages, or breakdowns as needed
4. If asked about spending by category, group and sum the amounts
5. Format currency amounts nicely (e.g., ₹1,234.56)
6. If no relevant transactions are found for the time period, say so clearly
7. Be concise but informative
8. If the question is vague, provide a helpful summary

Provide your answer:`;

        const response = await ai.generate({
            model: vertexAI.model('gemini-2.0-flash'),
            prompt: prompt,
        });
        
        console.log('💬 Answer:');
        console.log('═'.repeat(60));
        console.log(response.text);
        console.log('═'.repeat(60));
        
    } catch (error: any) {
        console.error('\n❌ Error occurred:');
        console.error('─'.repeat(60));
        console.error('Message:', error.message);
        if (error.code) console.error('Code:', error.code);
        if (error.details) console.error('Details:', error.details);
        console.error('─'.repeat(60));
        console.error('\nFull error:');
        console.error(error);
    }
    
    process.exit(0);
}

main();

