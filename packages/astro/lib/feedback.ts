import { feedbackHref } from '@ctcstack/ctcdocs-core';

import { siteConfiguration } from './project';

/**
 * The address where a reader of one page reports a problem, with that page's
 * canonical address filled in, or nothing when the project configures no
 * feedback. Built into the page, so it needs no script and stays the same
 * for every build of the same page.
 */
export function feedbackLinkFor(pathname: string): string | undefined {
  const { feedback, deployment } = siteConfiguration;
  if (!feedback) {
    return undefined;
  }
  const page = new URL(pathname, deployment.environments.production.url).href;
  return feedbackHref(feedback, page);
}
