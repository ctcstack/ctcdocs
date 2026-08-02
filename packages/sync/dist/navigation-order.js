import { hasUnrecognizedOrderPrefix, parseOrderedLabel, } from './ordered-label.js';
function landingRank(title, landingTitles) {
    const wanted = title.toLocaleLowerCase('en');
    const rank = landingTitles.findIndex((candidate) => candidate.toLocaleLowerCase('en') === wanted);
    return rank === -1 ? undefined : rank;
}
function sortKey(sibling, landingTitles) {
    const { order, label } = parseOrderedLabel(sibling.name);
    if (order !== null) {
        return { tier: 1, rank: order, label };
    }
    const landing = sibling.kind === 'document' ? landingRank(label, landingTitles) : undefined;
    return landing === undefined
        ? { tier: 2, rank: 0, label }
        : { tier: 0, rank: landing, label };
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
/**
 * A total order, so a set of siblings sorts the same however Drive happened to
 * list it. The label collation locale is pinned for the same reason: an
 * unqualified comparison follows the build machine's locale, and these names
 * are multilingual.
 */
export function compareNavigationSiblings(left, right, landingTitles) {
    const leftKey = sortKey(left, landingTitles);
    const rightKey = sortKey(right, landingTitles);
    return (leftKey.tier - rightKey.tier ||
        leftKey.rank - rightKey.rank ||
        leftKey.label.localeCompare(rightKey.label, 'en', {
            numeric: true,
            sensitivity: 'base',
        }) ||
        compareText(left.id, right.id));
}
/**
 * Reports the arrangements that leave the order undefined rather than merely
 * unusual. A folder mixing numbered and unnumbered siblings is not one of
 * them: the tiers define that case, and warning on a supported arrangement
 * would teach operators to ignore the channel.
 */
export function findNavigationOrderIssues(selection, landingTitles) {
    const siblingsById = new Map([
        ...selection.folders.map((node) => [
            node.item.id,
            { id: node.item.id, name: node.item.name, kind: 'folder' },
        ]),
        ...selection.documents.map((node) => [
            node.item.id,
            { id: node.item.id, name: node.item.name, kind: 'document' },
        ]),
    ]);
    const issues = [];
    for (const parent of selection.folders) {
        const siblings = [...parent.childFolderIds, ...parent.documentIds]
            .map((itemId) => siblingsById.get(itemId))
            .filter((sibling) => sibling !== undefined)
            .sort((left, right) => compareNavigationSiblings(left, right, landingTitles));
        const claimedOrders = new Map();
        let landingHolder;
        let usesConvention = false;
        for (const sibling of siblings) {
            const key = sortKey(sibling, landingTitles);
            if (key.tier !== 2) {
                usesConvention = true;
            }
            if (key.tier === 1) {
                const holder = claimedOrders.get(key.rank);
                if (holder) {
                    issues.push({
                        code: 'duplicate_navigation_order',
                        itemId: sibling.id,
                        relatedId: holder,
                    });
                }
                else {
                    claimedOrders.set(key.rank, sibling.id);
                }
            }
            if (key.tier === 0) {
                if (landingHolder) {
                    issues.push({
                        code: 'multiple_landing_documents',
                        itemId: sibling.id,
                        relatedId: landingHolder,
                    });
                }
                else {
                    landingHolder = sibling.id;
                }
            }
        }
        if (!usesConvention) {
            continue;
        }
        for (const sibling of siblings) {
            if (hasUnrecognizedOrderPrefix(sibling.name)) {
                issues.push({
                    code: 'unrecognized_order_prefix',
                    itemId: sibling.id,
                });
            }
        }
    }
    return issues.sort((left, right) => compareText(left.code, right.code) ||
        compareText(left.itemId, right.itemId));
}
