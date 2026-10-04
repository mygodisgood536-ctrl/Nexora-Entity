/**
 * Evidence roles a supplied source can play.
 *
 * The same address can legitimately be entered in more than one stage: a Wikipedia article may
 * be supplied as a press release and also as a website. Roles are therefore tracked
 * independently rather than as a single mutable kind, so one declaration can never silently
 * overwrite another.
 */

export interface SourceRoles {
  website: boolean;
  press: boolean;
  profile: boolean;
  page: boolean;
}

export const ROLE_BY_SUPPLIED_KIND: Record<string, SourceRoles> = {
  personal_site: { website: true, press: false, profile: false, page: true },
  professional_site: { website: true, press: false, profile: false, page: true },
  portfolio_site: { website: true, press: false, profile: false, page: true },
  project_site: { website: true, press: false, profile: false, page: true },
  organization_site: { website: true, press: false, profile: false, page: true },
  author_page: { website: true, press: false, profile: false, page: true },
  other: { website: true, press: false, profile: false, page: true },
  press_release: { website: false, press: true, profile: false, page: false },
  news_article: { website: false, press: true, profile: false, page: false },
  social_profile: { website: false, press: false, profile: true, page: false },
  professional_profile: { website: false, press: false, profile: true, page: false },
  creator_profile: { website: false, press: false, profile: true, page: false },
  public_page: { website: false, press: false, profile: false, page: true },
  portfolio_url: { website: false, press: false, profile: false, page: true },
};

export function roleFlags(suppliedKind: string): SourceRoles {
  return ROLE_BY_SUPPLIED_KIND[suppliedKind] ?? ROLE_BY_SUPPLIED_KIND['other']!;
}