# Deploying Firebase Functions

This guide outlines the steps to deploy the Firebase Cloud Functions for the Expense Tracker application.

## Prerequisites

1.  **Node.js**: Ensure you have Node.js 20 installed (as specified in `package.json`).
2.  **Firebase CLI**: Install the Firebase CLI globally if you haven't already:
    ```bash
    npm install -g firebase-tools
    ```
3.  **Firebase Login**: specific Log in to your Firebase account:
    ```bash
    firebase login
    ```

## 1. Google Cloud Setup

Ensure your Google Cloud project has the necessary APIs enabled. You can do this via the Google Cloud Console or using the `gcloud` CLI.

**Install gcloud CLI:** [Installation Guide](https://cloud.google.com/sdk/docs/install)

**Enable Required APIs:**

Run the following commands in your terminal. Replace `YOUR_PROJECT_ID` with your actual Firebase project ID.

```bash
# 1. Set your project
gcloud config set project YOUR_PROJECT_ID

# 2. Enable Cloud Functions API
gcloud services enable cloudfunctions.googleapis.com

# 3. Enable Vertex AI API (Required for Genkit/Gemini)
gcloud services enable aiplatform.googleapis.com

# 4. Enable Cloud Build API (Required for deploying functions)
gcloud services enable cloudbuild.googleapis.com

# 5. Enable Artifact Registry API (Required for Functions 2nd Gen)
gcloud services enable artifactregistry.googleapis.com
```

## 2. Installation

Before deploying, ensure all dependencies are installed:

```bash
cd functions
npm install
```

## 3. Configuration

### Allowed Emails
The function `analyzeTransactions` currently uses a hardcoded allowlist for emails.
Open `src/index.ts` and verify the `ALLOWED_EMAILS` array is configured correctly before deploying:

```typescript
// src/index.ts
const ALLOWED_EMAILS: string[] = ["your-email@example.com"];
```

*Note: For a more robust solution, consider moving this to Firebase Environment Variables.*

### Vertex AI Region
Ensure your Firebase project is on the "Blaze" (Pay as you go) plan, as Vertex AI requires it. Also ensure the Vertex AI API is enabled in your Google Cloud Console (covered in Step 1).

## 4. Local Testing (Optional but Recommended)

You can run the functions locally using the Firebase Emulator Suite:

```bash
npm run serve
```

This will build the project and start the emulators.

## 5. Deployment

To deploy the functions to your live Firebase project, run:

```bash
npm run deploy
```

Or using the Firebase CLI directly:

```bash
firebase deploy --only functions
```

### Deploying Specific Functions
If you only want to deploy a specific function (e.g., `analyzeTransactions`):

```bash
firebase deploy --only functions:analyzeTransactions
```

## 6. Troubleshooting

-   **"Error: specific function name not found"**: Make sure you have exported the function in `src/index.ts`.
-   **Permission Denied (Vertex AI)**: Ensure the Service Account used by Cloud Functions has the "Victory AI User" or "Vertex AI User" role, and the API is enabled in Cloud Console.
-   **Node Version Warning**: If you see warnings about Node versions, ensure explicitly your local version matches the `engines` field in `package.json`.

## Useful Scripts

-   `npm run build`: Compiles the TypeScript code to JavaScript.
-   `npm run logs`: View the logs of your deployed functions.
