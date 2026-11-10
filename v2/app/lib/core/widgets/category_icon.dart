import 'package:flutter/material.dart';

import '../domain/models.dart';
import '../theme/ledger_theme.dart';

/// Material icon names stored on categories, mapped to icons. The names match
/// what the original app stored so migrated categories keep their icon.
const Map<String, IconData> categoryIcons = {
  'attach_money': Icons.attach_money,
  'business': Icons.business,
  'card_giftcard': Icons.card_giftcard,
  'child_friendly': Icons.child_friendly,
  'face': Icons.face,
  'receipt': Icons.receipt,
  'receipt_long': Icons.receipt_long,
  'directions_car': Icons.directions_car,
  'checkroom': Icons.checkroom,
  'school': Icons.school,
  'devices': Icons.devices,
  'movie': Icons.movie,
  'restaurant': Icons.restaurant,
  'favorite': Icons.favorite,
  'home': Icons.home,
  'security': Icons.security,
  'shopping_cart': Icons.shopping_cart,
  'shopping_bag': Icons.shopping_bag,
  'people': Icons.people,
  'sports_soccer': Icons.sports_soccer,
  'account_balance': Icons.account_balance,
  'phone': Icons.phone,
  'directions_bus': Icons.directions_bus,
  'celebration': Icons.celebration,
  'local_grocery_store': Icons.local_grocery_store,
  'payments': Icons.payments,
  'savings': Icons.savings,
  'pets': Icons.pets,
  'flight': Icons.flight,
  'local_cafe': Icons.local_cafe,
  'fitness_center': Icons.fitness_center,
  'build': Icons.build,
  'local_hospital': Icons.local_hospital,
  'subscriptions': Icons.subscriptions,
  'category': Icons.category,
};

IconData iconForName(String? name) => categoryIcons[name] ?? Icons.category;

/// Parses `#RRGGBB`; falls back to [fallback] on anything else.
Color colorFromHex(String? hex, {Color fallback = const Color(0xFF3B82F6)}) {
  if (hex == null) return fallback;
  final h = hex.replaceFirst('#', '');
  if (h.length != 6) return fallback;
  final v = int.tryParse(h, radix: 16);
  return v == null ? fallback : Color(0xFF000000 | v);
}

String hexFromColor(Color c) =>
    '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

/// Square outlined tile with the category's icon; a thin colour bar carries
/// the category colour without fighting the Ledger palette.
class CategoryIcon extends StatelessWidget {
  const CategoryIcon({super.key, required this.category, this.size = 40});

  final Category? category;
  final double size;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: p.surface,
          border: Border.all(color: p.line),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Stack(
          children: [
            Center(
              child: Icon(iconForName(category?.icon), size: size * 0.5, color: p.ink),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              child: ColoredBox(color: colorFromHex(category?.color)),
            ),
          ],
        ),
      ),
    );
  }
}
