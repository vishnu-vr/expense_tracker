/**
 * MyMoney CSV Import Script
 * 
 * Usage: node scripts/import-mymoney.js <csv-file-path> <user-id> [user-email]
 * 
 * CSV Format expected:
 * "TIME","TYPE","AMOUNT","CATEGORY","ACCOUNT","NOTES"
 * "Dec 01, 2024 3:17 PM","(-) Expense","5300.00","Beauty","Cash",""
 * 
 * Features:
 * - Preserves EXACT category names from MyMoney export
 * - Creates new categories in Firestore if they don't exist
 * - Assigns appropriate icons/colors to new categories
 * - Imports all transactions with date, time, amount, and notes
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Default category icons and colors for new categories
const DEFAULT_ICONS = {
    expense: 'receipt',
    income: 'attach_money'
};

const DEFAULT_COLORS = {
    expense: '#9E9E9E',
    income: '#4CAF50'
};

// Pre-defined category mappings (MyMoney category name -> our category)
const CATEGORY_MAPPINGS = {
    // Common expense categories
    'beauty': { icon: 'face', color: '#F06292' },
    'food': { icon: 'restaurant', color: '#FF9800' },
    'food & drinks': { icon: 'restaurant', color: '#FF9800' },
    'groceries': { icon: 'local_grocery_store', color: '#8BC34A' },
    'grocery': { icon: 'local_grocery_store', color: '#8BC34A' },
    'transport': { icon: 'directions_bus', color: '#3F51B5' },
    'transportation': { icon: 'directions_bus', color: '#3F51B5' },
    'shopping': { icon: 'shopping_cart', color: '#03A9F4' },
    'entertainment': { icon: 'movie', color: '#673AB7' },
    'health': { icon: 'favorite', color: '#F44336' },
    'medical': { icon: 'local_hospital', color: '#F44336' },
    'bills': { icon: 'receipt', color: '#FF5722' },
    'utilities': { icon: 'receipt', color: '#FF5722' },
    'rent': { icon: 'home', color: '#795548' },
    'home': { icon: 'home', color: '#795548' },
    'education': { icon: 'school', color: '#3F51B5' },
    'clothing': { icon: 'checkroom', color: '#9C27B0' },
    'car': { icon: 'directions_car', color: '#2196F3' },
    'fuel': { icon: 'local_gas_station', color: '#FF5722' },
    'petrol': { icon: 'local_gas_station', color: '#FF5722' },
    'phone': { icon: 'phone', color: '#00BCD4' },
    'telephone': { icon: 'phone', color: '#00BCD4' },
    'mobile': { icon: 'phone_android', color: '#00BCD4' },
    'internet': { icon: 'wifi', color: '#2196F3' },
    'insurance': { icon: 'security', color: '#009688' },
    'tax': { icon: 'account_balance', color: '#9E9E9E' },
    'travel': { icon: 'flight', color: '#00BCD4' },
    'vacation': { icon: 'beach_access', color: '#00BCD4' },
    'gifts': { icon: 'card_giftcard', color: '#E91E63' },
    'baby': { icon: 'child_friendly', color: '#E91E63' },
    'kids': { icon: 'child_care', color: '#E91E63' },
    'pets': { icon: 'pets', color: '#795548' },
    'sports': { icon: 'sports_soccer', color: '#FFC107' },
    'fitness': { icon: 'fitness_center', color: '#4CAF50' },
    'gym': { icon: 'fitness_center', color: '#4CAF50' },
    'personal': { icon: 'person', color: '#607D8B' },
    'other': { icon: 'more_horiz', color: '#9E9E9E' },
    'miscellaneous': { icon: 'more_horiz', color: '#9E9E9E' },
    'electronics': { icon: 'devices', color: '#607D8B' },
    'subscription': { icon: 'subscriptions', color: '#673AB7' },
    'restaurant': { icon: 'restaurant', color: '#FF9800' },
    'cafe': { icon: 'local_cafe', color: '#795548' },
    'coffee': { icon: 'local_cafe', color: '#795548' },
    'alcohol': { icon: 'local_bar', color: '#9C27B0' },
    'drinks': { icon: 'local_bar', color: '#9C27B0' },
    'snacks': { icon: 'fastfood', color: '#FF9800' },
    'fast food': { icon: 'fastfood', color: '#FF9800' },
    
    // Income categories
    'salary': { icon: 'attach_money', color: '#4CAF50' },
    'business': { icon: 'business', color: '#8BC34A' },
    'freelance': { icon: 'work', color: '#4CAF50' },
    'investment': { icon: 'trending_up', color: '#2196F3' },
    'interest': { icon: 'savings', color: '#4CAF50' },
    'refund': { icon: 'replay', color: '#00BCD4' },
    'bonus': { icon: 'card_giftcard', color: '#FFC107' },
    'gift': { icon: 'card_giftcard', color: '#CDDC39' },
};

class MyMoneyImporter {
    constructor(serviceAccountPath) {
        // Initialize Firebase Admin
        const serviceAccount = require(serviceAccountPath);
        initializeApp({
            credential: cert(serviceAccount)
        });
        this.db = getFirestore();
        this.existingCategories = new Map();
        this.newCategories = [];
        this.transactions = [];
        this.stats = {
            total: 0,
            imported: 0,
            skipped: 0,
            newCategories: 0
        };
    }

    // Parse MyMoney date format: "Dec 01, 2024 3:17 PM"
    parseDate(dateStr) {
        // Remove quotes if present
        dateStr = dateStr.replace(/"/g, '').trim();
        
        // Parse the date string
        const date = new Date(dateStr);
        
        if (isNaN(date.getTime())) {
            console.warn(`  Warning: Could not parse date "${dateStr}", using current date`);
            return new Date();
        }
        
        return date;
    }

    // Parse MyMoney type: "(-) Expense" or "(+) Income"
    parseType(typeStr) {
        typeStr = typeStr.replace(/"/g, '').trim().toLowerCase();
        if (typeStr.includes('income') || typeStr.includes('(+)')) {
            return 'income';
        }
        return 'expense';
    }

    // Parse amount: "5300.00"
    parseAmount(amountStr) {
        amountStr = amountStr.replace(/"/g, '').trim();
        const amount = parseFloat(amountStr);
        return isNaN(amount) ? 0 : Math.abs(amount);
    }

    // Generate category ID from name (matches app's CategoryService format)
    getCategoryId(name) {
        // Same logic as Angular app: lowercase and replace spaces with underscores
        return name.toLowerCase().replace(/ /g, '_');
    }

    // Get or create category - preserves EXACT name from CSV export
    async getOrCreateCategory(categoryName, type) {
        // Preserve exact category name from export (just trim whitespace)
        const exactName = categoryName.trim();
        const categoryId = this.getCategoryId(exactName);
        
        // Check if we already processed this category
        if (this.existingCategories.has(categoryId)) {
            return categoryId;
        }

        // Check if category exists in Firestore
        const categoryRef = this.db.collection('categories').doc(categoryId);
        const categoryDoc = await categoryRef.get();

        if (categoryDoc.exists) {
            this.existingCategories.set(categoryId, categoryDoc.data());
            return categoryId;
        }

        // Create new category with EXACT name from export
        const lowerName = exactName.toLowerCase();
        const mapping = CATEGORY_MAPPINGS[lowerName] || {};
        
        const newCategory = {
            id: categoryId,
            name: exactName,  // Exact name from MyMoney export
            icon: mapping.icon || DEFAULT_ICONS[type],
            color: mapping.color || DEFAULT_COLORS[type],
            type: type
        };

        await categoryRef.set(newCategory);
        this.existingCategories.set(categoryId, newCategory);
        this.newCategories.push(newCategory);
        this.stats.newCategories++;
        
        console.log(`  Created new category: "${exactName}" (${type})`);
        
        return categoryId;
    }

    // Parse CSV line (handles quoted fields with commas)
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        
        return result;
    }

    // Parse CSV file
    parseCSV(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        // Skip header
        const dataLines = lines.slice(1);
        
        return dataLines.map(line => {
            const fields = this.parseCSVLine(line);
            return {
                time: fields[0]?.replace(/"/g, ''),
                type: fields[1]?.replace(/"/g, ''),
                amount: fields[2]?.replace(/"/g, ''),
                category: fields[3]?.replace(/"/g, ''),
                account: fields[4]?.replace(/"/g, ''),
                notes: fields[5]?.replace(/"/g, '') || ''
            };
        }).filter(row => row.time && row.amount);
    }

    // Import transactions
    async import(csvPath, userId, userEmail = null) {
        console.log('\n📊 MyMoney CSV Importer');
        console.log('========================\n');
        
        // Check if file exists
        if (!fs.existsSync(csvPath)) {
            throw new Error(`CSV file not found: ${csvPath}`);
        }

        console.log(`📁 Reading: ${csvPath}`);
        const rows = this.parseCSV(csvPath);
        this.stats.total = rows.length;
        console.log(`📝 Found ${rows.length} transactions\n`);

        // Process each row
        let batch = this.db.batch();
        let batchCount = 0;
        const BATCH_LIMIT = 400; // Firestore batch limit is 500

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            try {
                const type = this.parseType(row.type);
                const categoryId = await this.getOrCreateCategory(row.category, type);
                const date = this.parseDate(row.time);
                const amount = this.parseAmount(row.amount);

                if (amount <= 0) {
                    console.log(`  Skipped row ${i + 1}: Invalid amount`);
                    this.stats.skipped++;
                    continue;
                }

                const transaction = {
                    amount: amount,
                    type: type,
                    categoryId: categoryId,
                    date: date.toISOString(),
                    note: row.notes || '',
                    accountId: row.account || 'Cash',
                    userId: userId,
                    userEmail: userEmail || undefined
                };

                const docRef = this.db.collection('transactions').doc();
                batch.set(docRef, transaction);
                batchCount++;
                this.stats.imported++;

                // Commit batch if limit reached
                if (batchCount >= BATCH_LIMIT) {
                    console.log(`  Committing batch of ${batchCount} transactions...`);
                    await batch.commit();
                    // Create a NEW batch for the next set of transactions
                    batch = this.db.batch();
                    batchCount = 0;
                }

                // Progress indicator
                if ((i + 1) % 50 === 0) {
                    console.log(`  Processed ${i + 1}/${rows.length} transactions...`);
                }

            } catch (error) {
                console.error(`  Error processing row ${i + 1}:`, error.message);
                this.stats.skipped++;
            }
        }

        // Commit remaining transactions
        if (batchCount > 0) {
            console.log(`  Committing final batch of ${batchCount} transactions...`);
            await batch.commit();
        }

        // Print summary
        console.log('\n✅ Import Complete!');
        console.log('==================');
        console.log(`  Total rows:        ${this.stats.total}`);
        console.log(`  Imported:          ${this.stats.imported}`);
        console.log(`  Skipped:           ${this.stats.skipped}`);
        console.log(`  New categories:    ${this.stats.newCategories}`);
        
        if (this.newCategories.length > 0) {
            console.log('\n📂 New categories created:');
            this.newCategories.forEach(cat => {
                console.log(`    - ${cat.name} (${cat.type}, icon: ${cat.icon})`);
            });
        }

        console.log('\n');
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('Usage: node import-mymoney.js <csv-file-path> <user-id> [user-email] [service-account-path]');
        console.log('');
        console.log('Arguments:');
        console.log('  csv-file-path         Path to MyMoney CSV export file');
        console.log('  user-id               Firebase Auth user ID to assign transactions to');
        console.log('  user-email            (Optional) User email for display in the app');
        console.log('  service-account-path  (Optional) Path to Firebase service account JSON');
        console.log('                        Default: ./firebase-service-account.json');
        console.log('');
        console.log('Example:');
        console.log('  node import-mymoney.js ./mymoney-export.csv abc123xyz user@email.com');
        process.exit(1);
    }

    const csvPath = path.resolve(args[0]);
    const userId = args[1];
    
    // Check if arg[2] is an email or a path
    let userEmail = null;
    let serviceAccountPath = path.resolve(__dirname, '../firebase-service-account.json');
    
    if (args[2]) {
        if (args[2].includes('@')) {
            // It's an email
            userEmail = args[2];
            if (args[3]) {
                serviceAccountPath = path.resolve(args[3]);
            }
        } else {
            // It's a path
            serviceAccountPath = path.resolve(args[2]);
        }
    }

    // Check service account file
    if (!fs.existsSync(serviceAccountPath)) {
        console.error(`\n❌ Firebase service account file not found: ${serviceAccountPath}`);
        console.log('\nTo get a service account file:');
        console.log('1. Go to Firebase Console → Project Settings → Service Accounts');
        console.log('2. Click "Generate new private key"');
        console.log('3. Save the JSON file as firebase-service-account.json in the project root');
        process.exit(1);
    }

    console.log(`\n👤 User ID: ${userId}`);
    if (userEmail) {
        console.log(`📧 User Email: ${userEmail}`);
    }

    try {
        const importer = new MyMoneyImporter(serviceAccountPath);
        await importer.import(csvPath, userId, userEmail);
    } catch (error) {
        console.error('\n❌ Import failed:', error.message);
        process.exit(1);
    }
}

main();

