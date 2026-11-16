import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/money/money_format.dart';
import '../../../core/money/money_providers.dart';
import '../../../core/platform/file_sharer.dart';
import '../../../core/time/clock.dart';
import '../../../core/widgets/sections.dart';
import '../../../core/widgets/state_views.dart';
import '../data/reports.dart';
import 'report_controllers.dart';

/// G1 Reports. Managers see the whole business; a salesperson sees their own sales, without
/// cost or profit (the server leaves those out).
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  ReportRange _range = ReportRange.month;
  ReportPeriod? _custom;
  bool _exporting = false;

  ReportPeriod get _period => _range == ReportRange.custom
      ? _custom!
      : _range.periodOn(ref.read(clockProvider)());

  Future<void> _choose(ReportRange range) async {
    if (range != ReportRange.custom) {
      setState(() => _range = range);
      return;
    }
    final today = ref.read(clockProvider)();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(today.year - 5),
      lastDate: today,
      helpText: 'Report period',
    );
    if (picked == null || !mounted) return;
    if (picked.end.difference(picked.start).inDays > 366) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose a period of at most one year.')),
      );
      return;
    }
    setState(() {
      _range = ReportRange.custom;
      _custom = periodBetween(picked.start, picked.end);
    });
  }

  Future<void> _export({required bool stock}) async {
    if (_exporting) return;
    final messenger = ScaffoldMessenger.of(context);
    final period = _period;
    setState(() => _exporting = true);
    try {
      final api = ref.read(reportsApiProvider);
      final bytes = stock
          ? await api.valuationCsv()
          : await api.salesCsv(period);
      final shared = await ref.read(fileSharerProvider)(
        bytes: bytes,
        filename: stock
            ? 'velora-inventory.csv'
            : 'velora-sales-${period.from}-to-${period.to}.csv',
        mimeType: 'text/csv',
      );
      if (!shared) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Sharing is not available on this device.'),
          ),
        );
      }
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(describeFailure(failure))));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  static String _day(String iso) =>
      DateFormat('d MMM yyyy').format(DateTime.parse(iso));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final period = _period;
    final report = ref.watch(reportProvider(period));
    final manager = ref.watch(
      currentUserProvider.select((me) => me?.can('report.read_all') ?? false),
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reports'),
        actions: [
          if (manager)
            PopupMenuButton<bool>(
              key: const Key('export-menu'),
              tooltip: 'Export',
              icon: _exporting
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.ios_share),
              enabled: !_exporting,
              onSelected: (stock) => _export(stock: stock),
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: false,
                  child: Text('Sales for this period (CSV)'),
                ),
                PopupMenuItem(value: true, child: Text('Stock value (CSV)')),
              ],
            ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(
              horizontal: Space.lg,
              vertical: Space.sm,
            ),
            child: Row(
              children: [
                for (final range in ReportRange.values) ...[
                  ChoiceChip(
                    key: Key('range-${range.name}'),
                    label: Text(range.label),
                    selected: _range == range,
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onSelected: (_) => _choose(range),
                  ),
                  const SizedBox(width: Space.sm),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.sm),
            child: Text(
              period.from == period.to
                  ? _day(period.from)
                  : '${_day(period.from)} – ${_day(period.to)}',
              key: const Key('report-period'),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const Divider(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.refresh(reportProvider(period).future),
              child: AsyncValueView<ReportData>(
                value: report,
                onRetry: () => ref.invalidate(reportProvider(period)),
                data: (data) => _Report(data: data, ownOnly: !manager),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Report extends ConsumerWidget {
  const _Report({required this.data, required this.ownOnly});
  final ReportData data;
  final bool ownOnly;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final s = data.summary;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final team = data.team;
    final valuation = data.valuation;

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            ownOnly ? 'YOUR NET SALES' : 'NET SALES',
            style: tokens.overline,
            textAlign: TextAlign.center,
          ),
          Text(
            money.format(s.netSalesMinor),
            key: const Key('net-sales'),
            style: tokens.displayMoney,
            textAlign: TextAlign.center,
          ),
          Text(
            '${s.invoiceCount} ${s.invoiceCount == 1 ? 'invoice' : 'invoices'} · before tax, after discounts and returns',
            style: muted,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Sales',
            children: [
              FactRow(
                label: 'Invoiced (incl. tax)',
                value: money.format(s.invoicedMinor),
              ),
              FactRow(label: 'Tax collected', value: money.format(s.taxMinor)),
              FactRow(
                label: 'Discounts given',
                value: money.format(s.discountMinor),
              ),
              FactRow(label: 'Returns', value: money.format(s.returnsMinor)),
              FactRow(
                label: 'Money received',
                value: money.format(s.receivedMinor),
              ),
            ],
          ),
          if (s.grossProfitMinor != null) ...[
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Profit',
              children: [
                FactRow(
                  label: 'Cost of goods sold',
                  value: money.format(s.cogsMinor!),
                ),
                FactRow(
                  key: const Key('gross-profit'),
                  label: 'Gross profit',
                  value: money.format(s.grossProfitMinor!),
                  emphasize: true,
                ),
                FactRow(
                  label: 'Gross margin',
                  value: s.marginBp == null
                      ? '—'
                      : s.marginBp! < 0
                      ? '−${formatBasisPoints(-s.marginBp!)}'
                      : formatBasisPoints(s.marginBp!),
                ),
              ],
            ),
          ],
          const SizedBox(height: Space.lg),
          SectionCard(
            title: 'Owed now',
            children: [
              FactRow(
                key: const Key('outstanding-now'),
                label: 'Outstanding',
                value: money.format(s.outstandingNowMinor),
              ),
              FactRow(
                label: 'Of which overdue',
                value: money.format(s.overdueNowMinor),
              ),
              Text('As of today, whatever period is chosen.', style: muted),
            ],
          ),
          const SizedBox(height: Space.lg),
          _StatusCard(statuses: data.statuses),
          if (team != null) ...[
            const SizedBox(height: Space.lg),
            _TeamCard(team: team),
          ],
          if (valuation != null) ...[
            const SizedBox(height: Space.lg),
            SectionCard(
              title: 'Stock',
              children: [
                FactRow(
                  key: const Key('stock-value'),
                  label: 'Value at cost',
                  value: money.format(valuation.valueMinor),
                  emphasize: true,
                ),
                FactRow(
                  label: 'On hand',
                  value:
                      '${valuation.units} pcs · ${valuation.productCount} ${valuation.productCount == 1 ? 'product' : 'products'}',
                ),
                if (valuation.top.isNotEmpty) ...[
                  const Divider(),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: Space.sm),
                    child: Text('Most value held in', style: muted),
                  ),
                  for (final p in valuation.top)
                    FactRow(
                      label: '${p.name} · ${p.quantity} pcs',
                      value: money.format(p.valueMinor),
                    ),
                ],
                Text('As of today.', style: muted),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusCard extends ConsumerWidget {
  const _StatusCard({required this.statuses});
  final List<StatusCount> statuses;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final tokens = VeloraTokens.of(context);
    final money = ref.watch(moneyFormatterProvider);
    StatusCount of(String status) => statuses.firstWhere(
      (s) => s.status == status,
      orElse: () =>
          StatusCount(status: status, count: 0, totalMinor: 0, balanceMinor: 0),
    );
    final parts = [
      (label: 'Paid', tone: StatusTone.success, row: of('PAID')),
      (label: 'Partially paid', tone: StatusTone.warning, row: of('PARTIAL')),
      (label: 'Unpaid', tone: StatusTone.neutral, row: of('UNPAID')),
    ];
    final total = parts.fold<int>(0, (n, p) => n + p.row.count);
    final overdue = of('OVERDUE');
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    return SectionCard(
      title: 'Invoice status',
      children: [
        if (total == 0)
          Text('No invoices in this period.', style: muted)
        else ...[
          ExcludeSemantics(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(Space.xs),
              child: SizedBox(
                height: Space.md,
                child: Row(
                  children: [
                    for (final p in parts)
                      if (p.row.count > 0)
                        Expanded(
                          flex: p.row.count,
                          child: ColoredBox(
                            color: tokens.status(p.tone).foreground,
                          ),
                        ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: Space.sm),
          for (final p in parts)
            MergeSemantics(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.sm),
                child: Row(
                  children: [
                    Container(
                      width: Space.md,
                      height: Space.md,
                      decoration: BoxDecoration(
                        color: tokens.status(p.tone).foreground,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: Space.sm),
                    Expanded(
                      child: Text(
                        '${p.label} · ${p.row.count} (${formatBasisPoints((p.row.count * 10000 / total).round())})',
                        key: Key('status-${p.row.status}'),
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                    Text(
                      money.format(p.row.totalMinor),
                      style: theme.textTheme.titleSmall,
                    ),
                  ],
                ),
              ),
            ),
          if (overdue.count > 0)
            Text(
              '${overdue.count} overdue · ${money.format(overdue.balanceMinor)} still owed',
              key: const Key('status-OVERDUE'),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: tokens.status(StatusTone.danger).foreground,
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ],
    );
  }
}

class _TeamCard extends ConsumerWidget {
  const _TeamCard({required this.team});
  final List<SalespersonSales> team;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final money = ref.watch(moneyFormatterProvider);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final best = team.fold<int>(
      0,
      (m, t) => t.netSalesMinor > m ? t.netSalesMinor : m,
    );
    return SectionCard(
      title: 'Sales by team member',
      children: [
        if (team.isEmpty)
          Text('No sales in this period.', style: muted)
        else
          for (final t in team)
            MergeSemantics(
              child: Padding(
                key: Key('team-${t.memberId}'),
                padding: const EdgeInsets.symmetric(vertical: Space.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            t.fullName,
                            style: theme.textTheme.titleSmall,
                          ),
                        ),
                        Text(
                          money.format(t.netSalesMinor),
                          style: theme.textTheme.titleSmall,
                        ),
                      ],
                    ),
                    const SizedBox(height: Space.xs),
                    ExcludeSemantics(
                      child: LinearProgressIndicator(
                        // Length compares each person with the best seller of the period.
                        value: best > 0 && t.netSalesMinor > 0
                            ? t.netSalesMinor / best
                            : 0,
                        minHeight: Space.sm,
                        borderRadius: BorderRadius.circular(Space.xs),
                      ),
                    ),
                    const SizedBox(height: Space.xs),
                    Text(
                      '${t.invoiceCount} ${t.invoiceCount == 1 ? 'invoice' : 'invoices'} · profit ${money.format(t.grossProfitMinor)}',
                      style: muted,
                    ),
                  ],
                ),
              ),
            ),
      ],
    );
  }
}
