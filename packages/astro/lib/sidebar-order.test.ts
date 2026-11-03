import { describe, expect, it } from 'vitest';

import { inSidebarOrder, sidebarPositions } from './sidebar-order.js';

describe('sidebarPositions', () => {
  it('counts every slug once, depth first', () => {
    expect([
      ...sidebarPositions([
        'welcome',
        {
          label: 'Team',
          slug: 'team',
          items: ['team/plan', { label: 'Sub', items: ['team/sub/guide'] }],
        },
        'team/plan',
      ]),
    ]).toEqual([
      ['welcome', 0],
      ['team', 1],
      ['team/plan', 2],
      ['team/sub/guide', 3],
    ]);
  });
});

describe('inSidebarOrder', () => {
  const order = sidebarPositions([
    { label: '01 Sales', items: ['sales/pricing', 'sales/leads'] },
    { label: '02 Support', items: ['support/faq'] },
    'welcome',
  ]);

  it('puts each group where its first document is in the sidebar', () => {
    expect(
      inSidebarOrder(
        [
          { label: 'General', documents: [{ slug: 'welcome' }] },
          { label: 'Support', documents: [{ slug: 'support/faq' }] },
          {
            label: 'Sales',
            documents: [{ slug: 'sales/leads' }, { slug: 'sales/pricing' }],
          },
        ],
        order,
      ).map((group) => group.label),
    ).toEqual(['Sales', 'Support', 'General']);
  });

  it('puts a group the sidebar does not show last, by label', () => {
    expect(
      inSidebarOrder(
        [
          { label: 'Zeta', documents: [{ slug: 'zeta/one' }] },
          { label: 'Alpha', documents: [] },
          { label: 'Support', documents: [{ slug: 'support/faq' }] },
        ],
        order,
      ).map((group) => group.label),
    ).toEqual(['Support', 'Alpha', 'Zeta']);
  });
});
