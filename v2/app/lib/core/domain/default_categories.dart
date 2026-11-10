import 'models.dart';

const _i = TransactionType.income;
const _e = TransactionType.expense;

Category _c(String id, String name, String icon, String color, TransactionType t) =>
    Category(id: id, name: name, icon: icon, color: color, type: t, isDefault: true);

/// Built-in categories, same ids as the original app so migrated data lines up.
final List<Category> defaultCategories = List.unmodifiable([
  _c('salary', 'Salary', 'attach_money', '#4CAF50', _i),
  _c('business', 'Business', 'business', '#8BC34A', _i),
  _c('gifts', 'Gifts', 'card_giftcard', '#CDDC39', _i),
  _c('baby', 'Baby', 'child_friendly', '#E91E63', _e),
  _c('beauty', 'Beauty', 'face', '#F06292', _e),
  _c('bills', 'Bills', 'receipt', '#FF5722', _e),
  _c('car', 'Car', 'directions_car', '#2196F3', _e),
  _c('clothing', 'Clothing', 'checkroom', '#9C27B0', _e),
  _c('education', 'Education', 'school', '#3F51B5', _e),
  _c('electronics', 'Electronics', 'devices', '#607D8B', _e),
  _c('entertainment', 'Entertainment', 'movie', '#673AB7', _e),
  _c('food', 'Food', 'restaurant', '#FF9800', _e),
  _c('health', 'Health', 'favorite', '#F44336', _e),
  _c('home', 'Home', 'home', '#795548', _e),
  _c('insurance', 'Insurance', 'security', '#009688', _e),
  _c('shopping', 'Shopping', 'shopping_cart', '#03A9F4', _e),
  _c('social', 'Social', 'people', '#E91E63', _e),
  _c('sport', 'Sport', 'sports_soccer', '#FFC107', _e),
  _c('tax', 'Tax', 'account_balance', '#9E9E9E', _e),
  _c('telephone', 'Telephone', 'phone', '#00BCD4', _e),
  _c('transportation', 'Transportation', 'directions_bus', '#3F51B5', _e),
  _c('fun_activities', 'Fun Activities', 'celebration', '#FFEB3B', _e),
  _c('grocery', 'Grocery', 'local_grocery_store', '#8BC34A', _e),
  _c('gift', 'Gift', 'card_giftcard', '#CDDC39', _e),
]);

/// Slug used as the id of a custom category ("Pet Care" -> "pet_care").
String generateCategoryId(String name) => name
    .trim()
    .toLowerCase()
    .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
    .replaceAll(RegExp(r'^_+|_+$'), '');
