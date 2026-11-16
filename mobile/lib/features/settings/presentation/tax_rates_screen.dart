import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../../sell/data/sales_api.dart' show taxRatesProvider;
import '../data/organization.dart';
import '../data/settings_api.dart';
import 'percent.dart';

/// Tax rates (part of H3). A rate's percentage never changes — a new rate is added instead, so
/// old documents keep meaning what they said.
class TaxRatesScreen extends ConsumerWidget {
  const TaxRatesScreen({super.key});

  /// Runs a change, then reloads everything that shows tax rates.
  Future<void> _apply(
    BuildContext context,
    WidgetRef ref,
    Future<void> Function(SettingsApi api) change,
    String done,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await change(ref.read(settingsApiProvider));
      ref.invalidate(taxRatesAdminProvider);
      ref.invalidate(taxRatesProvider);
      // The default rate is part of the profile.
      await ref.read(sessionControllerProvider.notifier).refreshProfile();
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(done)));
    } on Failure catch (failure) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(describeFailure(failure))));
    }
  }

  Future<void> _actions(
    BuildContext context,
    WidgetRef ref,
    ManagedTaxRate rate,
  ) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(
                '${rate.name} · ${formatBasisPoints(rate.rateBp)}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            ListTile(
              key: const Key('rate-rename'),
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Rename'),
              onTap: () => Navigator.of(context).pop('rename'),
            ),
            if (rate.isActive && !rate.isDefault)
              ListTile(
                key: const Key('rate-default'),
                leading: const Icon(Icons.star_outline),
                title: const Text('Use as default'),
                onTap: () => Navigator.of(context).pop('default'),
              ),
            if (!rate.isDefault)
              ListTile(
                key: const Key('rate-toggle'),
                leading: Icon(
                  rate.isActive
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                ),
                title: Text(rate.isActive ? 'Stop using' : 'Use again'),
                subtitle: rate.isActive
                    ? const Text(
                        'It stays on existing documents but cannot be chosen for new ones.',
                      )
                    : null,
                onTap: () => Navigator.of(context).pop('toggle'),
              ),
          ],
        ),
      ),
    );
    if (action == null || !context.mounted) return;
    switch (action) {
      case 'rename':
        final name = await showDialog<String>(
          context: context,
          builder: (_) => _RenameDialog(current: rate.name),
        );
        if (name == null || name == rate.name || !context.mounted) return;
        await _apply(
          context,
          ref,
          (api) => api.updateTaxRate(rate.id, name: name),
          'Renamed to $name.',
        );
      case 'default':
        await _apply(
          context,
          ref,
          (api) => api.updateTaxRate(rate.id, isDefault: true),
          '${rate.name} is now the default.',
        );
      case 'toggle':
        await _apply(
          context,
          ref,
          (api) => api.updateTaxRate(rate.id, isActive: !rate.isActive),
          rate.isActive
              ? '${rate.name} is no longer offered.'
              : '${rate.name} can be chosen again.',
        );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final rates = ref.watch(taxRatesAdminProvider);
    final canEdit = ref.watch(
      currentUserProvider.select((me) => me?.can('settings.manage') ?? false),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Tax rates')),
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(
              key: const Key('add-tax-rate'),
              icon: const Icon(Icons.add),
              label: const Text('Add rate'),
              onPressed: () async {
                final added = await showDialog<ManagedTaxRate>(
                  context: context,
                  builder: (_) => const _AddRateDialog(),
                );
                if (added == null || !context.mounted) return;
                await _apply(
                  context,
                  ref,
                  (_) async {},
                  '${added.name} added.',
                );
              },
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(taxRatesAdminProvider.future),
        child: AsyncValueView<List<ManagedTaxRate>>(
          value: rates,
          onRetry: () => ref.invalidate(taxRatesAdminProvider),
          data: (list) => ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            // Room for the button, so it never covers the last rate.
            padding: const EdgeInsets.only(bottom: 96),
            itemCount: list.length,
            separatorBuilder: (_, _) =>
                const Divider(indent: Space.lg, endIndent: Space.lg),
            itemBuilder: (context, i) {
              final rate = list[i];
              return ListTile(
                key: Key('rate-${rate.name}'),
                title: Text(rate.name),
                subtitle: Text(formatBasisPoints(rate.rateBp)),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (rate.isDefault)
                      const StatusPill(
                        label: 'Default',
                        tone: StatusTone.success,
                      ),
                    if (!rate.isActive)
                      const StatusPill(
                        label: 'Not used',
                        tone: StatusTone.neutral,
                      ),
                    if (canEdit) ...[
                      const SizedBox(width: Space.sm),
                      Icon(
                        Icons.more_vert,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ],
                  ],
                ),
                onTap: canEdit ? () => _actions(context, ref, rate) : null,
              );
            },
          ),
        ),
      ),
    );
  }
}

class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.current});
  final String current;

  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.current);

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Rename tax rate'),
    content: Form(
      key: _form,
      child: LabeledField(
        key: const Key('rate-name'),
        label: 'Name',
        controller: _name,
        validator: _nameRule,
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      TextButton(
        key: const Key('rate-save'),
        onPressed: () {
          if (_form.currentState!.validate()) {
            Navigator.of(context).pop(_name.text.trim());
          }
        },
        child: const Text('Save'),
      ),
    ],
  );
}

String? _nameRule(String? v) {
  final text = (v ?? '').trim();
  if (text.isEmpty) return 'Required.';
  return text.length > 60 ? 'Use at most 60 characters.' : null;
}

/// Creates the rate itself, so a refused name is shown in the dialog. Pops with the new rate.
class _AddRateDialog extends ConsumerStatefulWidget {
  const _AddRateDialog();

  @override
  ConsumerState<_AddRateDialog> createState() => _AddRateDialogState();
}

class _AddRateDialogState extends ConsumerState<_AddRateDialog> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _percent = TextEditingController();
  bool _default = false;
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _name.dispose();
    _percent.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    try {
      final rate = await ref
          .read(settingsApiProvider)
          .createTaxRate(
            name: _name.text.trim(),
            rateBp: parsePercent(_percent.text)!,
            isDefault: _default,
          );
      navigator.pop(rate);
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Add tax rate'),
    content: Form(
      key: _form,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_failure != null) ...[
              Notice(message: describeFailure(_failure!)),
              const SizedBox(height: Space.lg),
            ],
            LabeledField(
              key: const Key('rate-name'),
              label: 'Name',
              hint: 'For example VAT 5%',
              controller: _name,
              enabled: !_busy,
              validator: _nameRule,
            ),
            const SizedBox(height: Space.lg),
            LabeledField(
              key: const Key('rate-percent'),
              label: 'Rate (%)',
              controller: _percent,
              enabled: !_busy,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              helperText: 'Cannot be changed later.',
              validator: (v) {
                final bp = parsePercent(v ?? '');
                return bp == null || bp > 10000
                    ? 'Enter a percentage from 0 to 100.'
                    : null;
              },
            ),
            SwitchListTile(
              key: const Key('rate-make-default'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Use as default'),
              value: _default,
              onChanged: _busy ? null : (v) => setState(() => _default = v),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      TextButton(
        key: const Key('rate-save'),
        onPressed: _busy ? null : _submit,
        child: const Text('Add'),
      ),
    ],
  );
}
