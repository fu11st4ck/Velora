import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/theme/tokens.dart';
import '../../../core/api/failure.dart';
import '../../../core/api/failure_messages.dart';
import '../../../core/auth/session.dart';
import '../../../core/auth/session_controller.dart';
import '../../../core/widgets/labeled_field.dart';
import '../../../core/widgets/notice.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/status_pill.dart';
import '../data/organization.dart';
import '../data/settings_api.dart';

const _roleHelp = {
  Role.owner: 'Everything, including settings and the team.',
  Role.manager: 'Sees cost and profit; manages products, stock, returns.',
  Role.sales: 'Sells and takes payments; never sees cost or profit.',
};

/// H4 Team. Managers see who is on the team; the owner invites, changes roles and deactivates.
class TeamScreen extends ConsumerWidget {
  const TeamScreen({super.key});

  Future<void> _update(
    BuildContext context,
    WidgetRef ref,
    TeamMember member, {
    Role? role,
    bool? isActive,
    required String done,
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(settingsApiProvider)
          .updateMember(member.memberId, role: role, isActive: isActive);
      ref.invalidate(teamProvider);
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
    TeamMember member,
  ) async {
    final action = await showModalBottomSheet<Object>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                title: Text(
                  member.fullName,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                subtitle: Text(member.email),
              ),
              if (member.isActive)
                for (final role in Role.values)
                  ListTile(
                    key: Key('role-${role.name}'),
                    leading: Icon(
                      role == member.role
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                    ),
                    title: Text(role.label),
                    subtitle: Text(_roleHelp[role]!),
                    selected: role == member.role,
                    onTap: () => Navigator.of(context).pop(role),
                  ),
              const Divider(),
              ListTile(
                key: const Key('member-toggle'),
                leading: Icon(
                  member.isActive
                      ? Icons.person_off_outlined
                      : Icons.person_outline,
                ),
                title: Text(
                  member.isActive ? 'Remove access' : 'Give access again',
                ),
                onTap: () => Navigator.of(context).pop(!member.isActive),
              ),
            ],
          ),
        ),
      ),
    );
    if (action == null || !context.mounted) return;
    if (action is Role) {
      if (action == member.role) return;
      await _update(
        context,
        ref,
        member,
        role: action,
        done:
            '${member.fullName} is now ${action.label}. They need to sign in again.',
      );
      return;
    }
    final activate = action as bool;
    if (!activate) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Remove access for ${member.fullName}?'),
          content: const Text(
            'They are signed out on every device and cannot sign in. Their sales and documents stay as they are. You can give access again later.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            TextButton(
              key: const Key('confirm-remove-access'),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Remove access'),
            ),
          ],
        ),
      );
      if (confirmed != true || !context.mounted) return;
    }
    await _update(
      context,
      ref,
      member,
      isActive: activate,
      done: activate
          ? '${member.fullName} can sign in again.'
          : '${member.fullName} no longer has access.',
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final me = ref.watch(currentUserProvider);
    final canManage = me?.can('team.manage') ?? false;
    final team = ref.watch(teamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Team')),
      floatingActionButton: canManage
          ? FloatingActionButton.extended(
              key: const Key('invite-member'),
              icon: const Icon(Icons.person_add_alt),
              label: const Text('Invite'),
              onPressed: () async {
                final messenger = ScaffoldMessenger.of(context);
                final invited = await showDialog<TeamMember>(
                  context: context,
                  builder: (_) => const _InviteDialog(),
                );
                if (invited == null) return;
                ref.invalidate(teamProvider);
                messenger
                  ..hideCurrentSnackBar()
                  ..showSnackBar(
                    SnackBar(
                      content: Text(
                        'Invitation emailed to ${invited.email}. The link works for 7 days.',
                      ),
                    ),
                  );
              },
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(teamProvider.future),
        child: AsyncValueView<List<TeamMember>>(
          value: team,
          onRetry: () => ref.invalidate(teamProvider),
          data: (members) => ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.only(bottom: 96),
            itemCount: members.length,
            separatorBuilder: (_, _) =>
                const Divider(indent: Space.lg, endIndent: Space.lg),
            itemBuilder: (context, i) {
              final m = members[i];
              final isMe = m.memberId == me?.memberId;
              final editable = canManage && !isMe;
              return ListTile(
                key: Key('member-${m.email}'),
                title: Text(isMe ? '${m.fullName} (you)' : m.fullName),
                subtitle: Text(m.email),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (!m.isActive)
                      const StatusPill(
                        label: 'No access',
                        tone: StatusTone.danger,
                      )
                    else if (m.isPending)
                      const StatusPill(
                        label: 'Invited',
                        tone: StatusTone.warning,
                      )
                    else
                      StatusPill(label: m.role.label, tone: StatusTone.neutral),
                    if (editable) ...[
                      const SizedBox(width: Space.sm),
                      Icon(
                        Icons.more_vert,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ],
                  ],
                ),
                onTap: editable ? () => _actions(context, ref, m) : null,
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Sends the invitation itself, so a refused email is shown in the dialog. Pops with the member.
class _InviteDialog extends ConsumerStatefulWidget {
  const _InviteDialog();

  @override
  ConsumerState<_InviteDialog> createState() => _InviteDialogState();
}

class _InviteDialogState extends ConsumerState<_InviteDialog> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  Role _role = Role.sales;
  bool _busy = false;
  Failure? _failure;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _failure = null);
    if (!_form.currentState!.validate()) return;
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    try {
      final member = await ref
          .read(settingsApiProvider)
          .invite(
            fullName: _name.text.trim(),
            email: _email.text.trim(),
            role: _role,
          );
      navigator.pop(member);
    } on Failure catch (failure) {
      if (mounted) setState(() => _failure = failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Invite a team member'),
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
              key: const Key('invite-name'),
              label: 'Full name',
              controller: _name,
              enabled: !_busy,
              validator: (v) {
                final text = (v ?? '').trim();
                if (text.length < 2) return 'Enter their name.';
                return text.length > 120 ? 'Use at most 120 characters.' : null;
              },
            ),
            const SizedBox(height: Space.lg),
            LabeledField(
              key: const Key('invite-email'),
              label: 'Email',
              controller: _email,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              helperText: 'They get a link to choose their password.',
              validator: (v) =>
                  RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                      .hasMatch((v ?? '').trim())
                  ? null
                  : 'Enter a valid email address.',
            ),
            const SizedBox(height: Space.lg),
            SegmentedButton<Role>(
              segments: const [
                ButtonSegment(value: Role.sales, label: Text('Sales')),
                ButtonSegment(value: Role.manager, label: Text('Manager')),
              ],
              selected: {_role},
              showSelectedIcon: false,
              onSelectionChanged: _busy
                  ? null
                  : (s) => setState(() => _role = s.first),
            ),
            const SizedBox(height: Space.sm),
            Text(
              _roleHelp[_role]!,
              style: Theme.of(context).textTheme.bodySmall,
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
        key: const Key('invite-send'),
        onPressed: _busy ? null : _submit,
        child: const Text('Send invitation'),
      ),
    ],
  );
}
