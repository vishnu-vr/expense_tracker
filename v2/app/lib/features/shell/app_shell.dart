import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/ledger_theme.dart';

/// Bottom navigation: Home, Ledger, add button, Budgets, Insights.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  void _go(int index) {
    HapticFeedback.selectionClick();
    shell.goBranch(index, initialLocation: index == shell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    Widget tab(String label, int index) => Expanded(
          child: _NavTab(
            label: label,
            selected: shell.currentIndex == index,
            onTap: () => _go(index),
          ),
        );

    final p = context.palette;
    return Scaffold(
      body: shell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: p.ground,
          border: Border(top: BorderSide(color: p.ink)),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 76,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  tab('Home', 0),
                  tab('Ledger', 1),
                  Expanded(
                    child: Center(
                      child: Semantics(
                        button: true,
                        label: 'Add entry',
                        child: Material(
                          color: p.ink,
                          borderRadius: BorderRadius.circular(12),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap: () {
                              HapticFeedback.lightImpact();
                              context.push('/add');
                            },
                            child: SizedBox(
                              width: 52,
                              height: 52,
                              child: Icon(Icons.add, color: p.onInk, size: 24),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  tab('Budgets', 2),
                  tab('Insights', 3),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavTab extends StatelessWidget {
  const _NavTab({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          height: 56,
          child: Center(
            child: Text(
              label,
              style: LedgerText.body(
                size: 12,
                weight: selected ? 600 : 400,
                color: selected ? p.ink : p.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
