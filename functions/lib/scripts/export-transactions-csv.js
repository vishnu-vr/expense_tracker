"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const PROJECT_ID = "public-exp-tracker";
const SA_PATH = path.resolve(__dirname, "../../service-account.json");
const DEFAULT_OUT_DIR = path.resolve(__dirname, "../../exports");
const DEFAULT_CATEGORY_NAMES = new Map([
    ["salary", "Salary"],
    ["business", "Business"],
    ["gifts", "Gifts"],
    ["baby", "Baby"],
    ["beauty", "Beauty"],
    ["bills", "Bills"],
    ["car", "Car"],
    ["clothing", "Clothing"],
    ["education", "Education"],
    ["electronics", "Electronics"],
    ["entertainment", "Entertainment"],
    ["food", "Food"],
    ["health", "Health"],
    ["home", "Home"],
    ["insurance", "Insurance"],
    ["shopping", "Shopping"],
    ["social", "Social"],
    ["sport", "Sport"],
    ["tax", "Tax"],
    ["telephone", "Telephone"],
    ["transportation", "Transportation"],
    ["fun_activities", "Fun Activities"],
    ["grocery", "Grocery"],
    ["gift", "gift"],
]);
function parseArgs(argv) {
    const argMap = new Map();
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (!key.startsWith("--"))
            continue;
        const value = argv[i + 1];
        if (!value || value.startsWith("--")) {
            argMap.set(key, "");
            continue;
        }
        argMap.set(key, value);
        i++;
    }
    const homeId = argMap.get("--homeId") || "";
    const month = argMap.get("--month");
    const from = argMap.get("--from");
    const to = argMap.get("--to");
    const out = argMap.get("--out");
    if (!homeId) {
        throw new Error("Missing required argument: --homeId <homeId>");
    }
    if (month) {
        const monthMatch = /^(\d{4})-(\d{2})$/.exec(month);
        if (!monthMatch) {
            throw new Error("Invalid --month format. Use YYYY-MM (example: 2025-11).");
        }
        const year = Number(monthMatch[1]);
        const monthIndex = Number(monthMatch[2]) - 1;
        if (monthIndex < 0 || monthIndex > 11) {
            throw new Error("Invalid --month value. Month must be between 01 and 12.");
        }
        const start = new Date(year, monthIndex, 1);
        const end = new Date(year, monthIndex + 1, 0);
        return {
            homeId,
            from: toDateOnly(start),
            to: toDateOnly(end),
            out,
        };
    }
    if (!from || !to) {
        throw new Error("Provide either --month YYYY-MM or both --from YYYY-MM-DD and --to YYYY-MM-DD.");
    }
    return { homeId, from, to, out };
}
function parseDateOnly(value, label) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        throw new Error(`Invalid ${label} format. Use YYYY-MM-DD.`);
    }
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);
    if (Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== monthIndex ||
        date.getDate() !== day) {
        throw new Error(`Invalid ${label} date value: ${value}`);
    }
    return date;
}
function toDateOnly(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function formatDateForCsv(iso) {
    if (!iso)
        return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return iso;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}
function csvEscape(value) {
    const normalized = value == null ? "" : String(value);
    if (/[",\n\r]/.test(normalized)) {
        return `"${normalized.replace(/"/g, "\"\"")}"`;
    }
    return normalized;
}
function usage() {
    return [
        "Usage:",
        "  npx ts-node src/scripts/export-transactions-csv.ts --homeId <id> --from YYYY-MM-DD --to YYYY-MM-DD [--out exports/file.csv]",
        "  npx ts-node src/scripts/export-transactions-csv.ts --homeId <id> --month YYYY-MM [--out exports/file.csv]",
        "",
        "Examples:",
        "  npx ts-node src/scripts/export-transactions-csv.ts --homeId tNb6OFW20pjIK7AbNLxj --from 2025-11-01 --to 2025-11-30",
        "  npx ts-node src/scripts/export-transactions-csv.ts --homeId tNb6OFW20pjIK7AbNLxj --month 2025-11 --out exports/november.csv",
    ].join("\n");
}
async function loadCategoryNameMap(db, homeId) {
    const categoryNameMap = new Map(DEFAULT_CATEGORY_NAMES);
    const homeCategoriesSnapshot = await db.collection("homes").doc(homeId).collection("categories").get();
    homeCategoriesSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.name) {
            categoryNameMap.set(doc.id, data.name);
        }
    });
    return categoryNameMap;
}
async function loadUserNameMap(db, userIds) {
    const userNameMap = new Map();
    await Promise.all(userIds.map(async (userId) => {
        const userSnap = await db.collection("users").doc(userId).get();
        if (userSnap.exists) {
            const userData = userSnap.data();
            if (userData.name) {
                userNameMap.set(userId, userData.name);
                return;
            }
        }
        userNameMap.set(userId, userId);
    }));
    return userNameMap;
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const fromDate = parseDateOnly(options.from, "--from");
    const toDate = parseDateOnly(options.to, "--to");
    if (fromDate.getTime() > toDate.getTime()) {
        throw new Error("--from cannot be after --to.");
    }
    const fromIsoStart = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0).toISOString();
    const toIsoEnd = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999).toISOString();
    const outFileName = options.out || `transactions_${options.homeId}_${options.from}_to_${options.to}.csv`;
    const outFilePath = path.isAbsolute(outFileName)
        ? outFileName
        : path.resolve(DEFAULT_OUT_DIR, outFileName);
    const serviceAccount = JSON.parse(await fs.readFile(SA_PATH, "utf8"));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: PROJECT_ID,
    });
    const db = admin.firestore();
    console.log(`Project      : ${PROJECT_ID}`);
    console.log(`Home         : ${options.homeId}`);
    console.log(`Period       : ${options.from} to ${options.to}`);
    console.log(`Output       : ${outFilePath}`);
    const txSnapshot = await db
        .collection("transactions")
        .where("homeId", "==", options.homeId)
        .where("date", ">=", fromIsoStart)
        .where("date", "<=", toIsoEnd)
        .orderBy("date", "asc")
        .get();
    const transactions = txSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
    const userIds = Array.from(new Set(transactions
        .map((tx) => tx.userId)
        .filter((id) => !!id)));
    const [categoryNameMap, userNameMap] = await Promise.all([
        loadCategoryNameMap(db, options.homeId),
        loadUserNameMap(db, userIds),
    ]);
    const csvLines = [];
    csvLines.push("Date,Type,Amount,Category,Note,User,Email");
    for (const tx of transactions) {
        const categoryName = tx.categoryId ? categoryNameMap.get(tx.categoryId) || tx.categoryId : "";
        const userName = tx.userId ? userNameMap.get(tx.userId) || tx.userId : "";
        csvLines.push([
            formatDateForCsv(tx.date),
            tx.type || "",
            typeof tx.amount === "number" ? tx.amount.toString() : "",
            categoryName,
            tx.note || "",
            userName,
            tx.userEmail || "",
        ]
            .map(csvEscape)
            .join(","));
    }
    await fs.mkdir(path.dirname(outFilePath), { recursive: true });
    await fs.writeFile(outFilePath, `${csvLines.join("\n")}\n`, "utf8");
    console.log(`Exported ${transactions.length} transaction(s) to ${outFilePath}`);
}
main().catch((error) => {
    console.error("Export failed:", error instanceof Error ? error.message : error);
    console.error(usage());
    process.exit(1);
});
//# sourceMappingURL=export-transactions-csv.js.map