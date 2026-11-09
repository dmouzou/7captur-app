/** Records that can support a recommendation. Costs alone cannot: they say nothing about what was posted, promoted or sold. */
export function commercialRecordCount(sets: { posts: unknown[]; promotions: unknown[]; leads: unknown[]; sales: unknown[] }): number {
  return sets.posts.length + sets.promotions.length + sets.leads.length + sets.sales.length;
}

export const NO_RECORDS_MESSAGE =
  "There are no posts, promotions, enquiries or sales in the last 28 days, so there is nothing to base a recommendation on. Enter records manually, import a file, or connect a source first.";
