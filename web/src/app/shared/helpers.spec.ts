import { describe, expect, it } from 'vitest';
import { dashboardFixture } from '../../testing/fixtures';
import type { DocumentSummary } from '../core/api/types';
import { formatCalendarDate, formatInstant, greeting } from '../core/dates/dates';
import { visibleNavigation } from '../layout/navigation';
import { documentStatus } from './domain/document-status';

const invoice = dashboardFixture().recentDocuments[0]! as DocumentSummary;

describe('documentStatus', () => {
  it('follows the mobile app priority: cancelled, overdue, then payment status', () => {
    expect(documentStatus({ ...invoice, status: 'CANCELLED', isOverdue: true })).toEqual({ label: 'Cancelled', tone: 'danger' });
    expect(documentStatus({ ...invoice, isOverdue: true })).toEqual({ label: 'Overdue', tone: 'danger' });
    expect(documentStatus({ ...invoice, paymentStatus: 'PAID' })).toEqual({ label: 'Paid', tone: 'success' });
    expect(documentStatus(invoice)).toEqual({ label: 'Partially paid', tone: 'warning' });
    expect(documentStatus({ ...invoice, paymentStatus: 'UNPAID' })).toEqual({ label: 'Unpaid', tone: 'warning' });
    const q = { ...invoice, type: 'QUOTATION' } as DocumentSummary;
    expect(documentStatus({ ...q, quotationStatus: 'OPEN' }).label).toBe('Quotation');
    expect(documentStatus({ ...q, quotationStatus: 'CONVERTED' }).label).toBe('Converted');
    expect(documentStatus({ ...q, quotationStatus: 'EXPIRED' }).label).toBe('Expired');
  });
});

describe('dates', () => {
  it('uses the business time zone, not the browser one', () => {
    // 22:30 UTC on 24 Nov is already 25 Nov in Dubai (UTC+4).
    expect(formatInstant('2026-11-24T22:30:00.000Z', 'Asia/Dubai')).toBe('25 Nov 2026');
    expect(formatInstant('2026-11-24T22:30:00.000Z', 'Europe/London')).toBe('24 Nov 2026');
    expect(formatCalendarDate('2026-12-25')).toBe('25 Dec 2026');
    expect(greeting(new Date('2026-11-25T05:00:00Z'), 'Asia/Dubai')).toBe('Good morning'); // 09:00 Dubai
    expect(greeting(new Date('2026-11-25T11:00:00Z'), 'Asia/Dubai')).toBe('Good afternoon');
    expect(greeting(new Date('2026-11-25T15:00:00Z'), 'Asia/Dubai')).toBe('Good evening');
  });
});

describe('visibleNavigation', () => {
  it('hides items the role may not use, and groups left empty', () => {
    const groups = [
      { label: 'Operations', items: [{ label: 'Dashboard', icon: 'x', path: '/dashboard' }] },
      { label: 'Admin', items: [{ label: 'Team', icon: 'x', path: '/settings/team', permission: 'team.read' }] },
    ];
    expect(visibleNavigation(() => false, groups).map((g) => g.label)).toEqual(['Operations']);
    expect(visibleNavigation((p) => p === 'team.read', groups).map((g) => g.label)).toEqual(['Operations', 'Admin']);
  });
});
