import { Category } from "./types";

/** Built-in categories, identical to the v1 app's defaults. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  // Income
  { id: "salary", name: "Salary", icon: "attach_money", color: "#4CAF50", type: "income" },
  { id: "business", name: "Business", icon: "business", color: "#8BC34A", type: "income" },
  { id: "gifts", name: "Gifts", icon: "card_giftcard", color: "#CDDC39", type: "income" },
  // Expense
  { id: "baby", name: "Baby", icon: "child_friendly", color: "#E91E63", type: "expense" },
  { id: "beauty", name: "Beauty", icon: "face", color: "#F06292", type: "expense" },
  { id: "bills", name: "Bills", icon: "receipt", color: "#FF5722", type: "expense" },
  { id: "car", name: "Car", icon: "directions_car", color: "#2196F3", type: "expense" },
  { id: "clothing", name: "Clothing", icon: "checkroom", color: "#9C27B0", type: "expense" },
  { id: "education", name: "Education", icon: "school", color: "#3F51B5", type: "expense" },
  { id: "electronics", name: "Electronics", icon: "devices", color: "#607D8B", type: "expense" },
  { id: "entertainment", name: "Entertainment", icon: "movie", color: "#673AB7", type: "expense" },
  { id: "food", name: "Food", icon: "restaurant", color: "#FF9800", type: "expense" },
  { id: "health", name: "Health", icon: "favorite", color: "#F44336", type: "expense" },
  { id: "home", name: "Home", icon: "home", color: "#795548", type: "expense" },
  { id: "insurance", name: "Insurance", icon: "security", color: "#009688", type: "expense" },
  { id: "shopping", name: "Shopping", icon: "shopping_cart", color: "#03A9F4", type: "expense" },
  { id: "social", name: "Social", icon: "people", color: "#E91E63", type: "expense" },
  { id: "sport", name: "Sport", icon: "sports_soccer", color: "#FFC107", type: "expense" },
  { id: "tax", name: "Tax", icon: "account_balance", color: "#9E9E9E", type: "expense" },
  { id: "telephone", name: "Telephone", icon: "phone", color: "#00BCD4", type: "expense" },
  { id: "transportation", name: "Transportation", icon: "directions_bus", color: "#3F51B5", type: "expense" },
  { id: "fun_activities", name: "Fun Activities", icon: "celebration", color: "#FFEB3B", type: "expense" },
  { id: "grocery", name: "Grocery", icon: "local_grocery_store", color: "#8BC34A", type: "expense" },
  { id: "gift", name: "gift", icon: "card_giftcard", color: "#CDDC39", type: "expense" },
];

/** Defaults overlaid with the home's own `categories` docs (home wins on id clash). */
export function mergeCategories(homeCategories: Category[]): Category[] {
  const merged = new Map<string, Category>();
  for (const c of DEFAULT_CATEGORIES) merged.set(c.id, c);
  for (const c of homeCategories) merged.set(c.id, c);
  return [...merged.values()];
}

export function categoryNameLookup(categories: Category[]): (id: string) => string {
  const byId = new Map(categories.map((c) => [c.id, c.name]));
  return (id: string) => byId.get(id) ?? id ?? "Uncategorized";
}
