import * as admin from 'firebase-admin';
// Mock admin before import index
if (admin.apps.length === 0) {
    //admin.initializeApp(); // index.ts does this, but we might need to mock if we want to control it
    // Actually index.ts calls initializeApp, handling it is tricky if we don't use 'firebase-functions-test' features fully.
    // But 'firebase-functions-test' online mode usually works.
}

// Initialize offline mode for speed/isolation if possible, or online if we need auth verification logic?
// usage of verifyIdToken() in index.ts requires a real project or mocking admin.auth().
// Since we want to test LOCAL debugging, we should MOCK admin.auth().verifyIdToken() if we reach that path.
// But we are passing 'auth' context, so it should hit the first check: request.auth?.uid.


import { analyzeTransactionsHandler } from './index';

async function run() {
    console.log('Running debug script DIRECTLY against handler...');

    const data = { question: 'Debug Question' };

    // Test Case 1: Valid Auth
    try {
        console.log('--- Test 1: Valid User ---');
        const request = {
            data,
            auth: {
                uid: 'testUser',
                token: {
                    email: 'vishnuramesh52@gmail.com',
                    uid: 'testUser'
                }
            }
        };
        const result = await analyzeTransactionsHandler(request);
        console.log('Success! Result:', result);
    } catch (e) {
        console.error('Failed:', e);
    }

    // Test Case 2: Wrong Email
    try {
        console.log('\n--- Test 2: Wrong Email ---');
        const request = {
            data,
            auth: {
                uid: 'badUser',
                token: {
                    email: 'vishnuramesh52@gmail.com',
                    uid: 'testUser'
                }
            }
        };
        await analyzeTransactionsHandler(request);
        console.error('Should have failed!');
    } catch (e: any) {
        console.log('Correctly failed with:', e.message);
    }

    // Test Case 3: No Auth
    try {
        console.log('\n--- Test 3: No Auth ---');
        const request = {
            data,
            auth: null
        };
        await analyzeTransactionsHandler(request);
        console.error('Should have failed!');
    } catch (e: any) {
        console.log('Correctly failed with:', e.message);
    }
}

run();
