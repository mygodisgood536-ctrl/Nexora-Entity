import { describe, expect, it } from 'vitest';
import { scanForProhibitedClaims } from '@nexora/core';
import { evaluateReadiness } from '../src/readiness';
import { ambiguity, completeClaims, completeEntity, completeSources, conflict } from './complete-entity';

const checkById = (report: ReturnType<typeof evaluateReadiness>, id: string) =>
  report.checks.find((c) => c.id === id);

describe('Entity Readiness: the three evidence minimums', () => {
  it('passes the website minimum at exactly 5', () => {
    expect(checkById(evaluateReadiness(completeEntity()), 'websites_minimum_5')?.outcome).toBe('pass');
  });

  it('fails the website minimum at 4', () => {
    const report = evaluateReadiness(completeEntity({ websiteQualifying: 4 }));
    const check = checkById(report, 'websites_minimum_5');
    expect(check?.outcome).toBe('fail');
    expect(check?.blocking).toBe(true);
    expect(report.status).toBe('blocked');
    expect(report.score).toBeLessThan(100);
  });

  it('fails the press minimum at 3 and states the shortfall', () => {
    const report = evaluateReadiness(completeEntity({ pressQualifying: 3, independentPressGroups: 3 }));
    const check = checkById(report, 'press_minimum_4');
    expect(check?.outcome).toBe('fail');
    expect(check?.detail).toContain('3');
    expect(report.status).toBe('blocked');
  });

  it('warns when 4 press releases come from fewer than 4 independent sources', () => {
    // Four qualifying releases, but only two independent outlets. Copies of one release are
    // already excluded from the count, so this is a warning about corroboration strength, not a
    // failure of the minimum itself.
    const sources = completeSources().map((s) =>
      s.supplied_kind === 'press_release' ? { ...s, independence_group: s.id <= 'press-g2' ? 'outlet-a' : 'outlet-b' } : s,
    );
    const report = evaluateReadiness(completeEntity({ sources, pressQualifying: 4, independentPressGroups: 2 }));
    expect(checkById(report, 'press_minimum_4')?.outcome).toBe('pass');
    expect(report.warnings.some((w) => w.code === 'press_independence')).toBe(true);
  });

  it('fails the photo minimum at 3', () => {
    expect(checkById(evaluateReadiness(completeEntity({ photosQualifying: 3 })), 'photos_minimum_4')?.outcome).toBe('fail');
  });

  it('recomputes the photo count rather than trusting the caller', () => {
    // Regression: the website and press minimums were clamped against the source records in
    // front of the gate, but the photo minimum trusted the caller's summary number outright. A
    // caller claiming four qualifying photos while supplying none could therefore pass the
    // photo requirement — the exact lie the clamp exists to prevent.
    const lying = evaluateReadiness(completeEntity({ photosQualifying: 99, photos: [] }));
    const check = checkById(lying, 'photos_minimum_4');
    expect(check?.outcome).toBe('fail');
    expect(check?.detail).toContain('0 of 4');
    expect(lying.status).toBe('blocked');
    expect(lying.blockingIssues.some((b) => b.checkId === 'photos_minimum_4')).toBe(true);
  });

  it('does not count rejected photos toward the photo minimum', () => {
    const withRejected = evaluateReadiness(completeEntity({ photosQualifying: 4, photos: [] }));
    expect(checkById(withRejected, 'photos_minimum_4')?.outcome).toBe('fail');
  });

  it('reports a publishable entity at 100% when every minimum is met', () => {
    const report = evaluateReadiness(completeEntity());
    expect(report.status).toBe('ready');
    expect(report.score).toBe(100);
    expect(report.blockingIssues).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('reports a blocking issue that names where to go and what to do', () => {
    const report = evaluateReadiness(completeEntity({ websiteQualifying: 0 }));
    const issue = report.blockingIssues.find((b) => b.checkId === 'websites_minimum_5');
    expect(issue).toBeDefined();
    expect(issue?.title.length).toBeGreaterThan(0);
    expect(issue?.action.length).toBeGreaterThan(0);
    expect(issue?.actionHref).toBe('/app/stages/N_websites');
  });
});

describe('Entity Readiness: blocking issues', () => {
  it('blocks on an open conflict', () => {
    const report = evaluateReadiness(completeEntity({ conflicts: [conflict()] }));
    expect(report.status).toBe('blocked');
    expect(checkById(report, 'conflicts_resolved')?.outcome).toBe('fail');
  });

  it('does not block once a conflict is resolved', () => {
    const report = evaluateReadiness(completeEntity({ conflicts: [conflict({ status: 'resolved_by_user' })] }));
    expect(report.status).toBe('ready');
    expect(checkById(report, 'conflicts_resolved')?.outcome).toBe('pass');
  });

  it('blocks on a blocking ambiguity', () => {
    const report = evaluateReadiness(completeEntity({ ambiguities: [ambiguity()] }));
    expect(report.status).toBe('blocked');
    expect(checkById(report, 'ambiguity_resolved')?.outcome).toBe('fail');
  });

  it('blocks on pending review items', () => {
    const report = evaluateReadiness(completeEntity({ reviewPending: 2, reviewBlocking: 1 }));
    expect(report.status).toBe('blocked');
  });

  it('never reports 100% while blocked', () => {
    for (const overrides of [
      { websiteQualifying: 0 },
      { photosQualifying: 0 },
      { conflicts: [conflict()] },
      { ambiguities: [ambiguity()] },
      { reviewPending: 1, reviewBlocking: 1 },
    ]) {
      const report = evaluateReadiness(completeEntity(overrides));
      expect(report.status).toBe('blocked');
      expect(report.score).toBeLessThanOrEqual(99);
    }
  });

  it('deduplicates repeated blocking issues so the UI is not flooded', () => {
    const report = evaluateReadiness(completeEntity({ conflicts: [conflict(), conflict({ id: 'cf2' })] }));
    const codes = report.blockingIssues.map((b) => b.code);
    // Different conflicts have different ids, so they are distinct issues...
    expect(new Set(codes).size).toBe(codes.length);
    // ...but the same conflict reported twice by two checks is not.
    const dupes = completeEntity({ conflicts: [conflict({ id: 'same' }), conflict({ id: 'same' })] });
    const sameCodes = evaluateReadiness(dupes).blockingIssues.map((b) => b.code);
    expect(new Set(sameCodes).size).toBe(sameCodes.length);
  });
});

describe('Entity Readiness: the mandatory second pass', () => {
  it('is absent on the initial run', () => {
    expect(evaluateReadiness(completeEntity({ kind: 'standard' })).secondPassAnswers).toBeUndefined();
  });

  it('is present on the second pass, with a question and an answer for every entry', () => {
    const report = evaluateReadiness(completeEntity({ kind: 'second_pass' }));
    expect(Array.isArray(report.secondPassAnswers)).toBe(true);
    expect(report.secondPassAnswers!.length).toBeGreaterThan(0);
    for (const answer of report.secondPassAnswers!) {
      expect(answer.question.length).toBeGreaterThan(0);
      expect(answer.answer.length).toBeGreaterThan(0);
      expect(answer.detail.length).toBeGreaterThan(0);
    }
  });

  it('re-derives the evidence minimums from the records, not from the caller summary', () => {
    // The second pass must reach its own verdict rather than restating the first pass's. The
    // sharpest way to prove that is to hand it a caller summary it must not trust: 99 qualifying
    // websites claimed, zero source records supplied. A pass that echoed the first pass, or
    // read report.completeness, would answer "Yes" here.
    const lying = evaluateReadiness(
      completeEntity({ kind: 'second_pass', websiteQualifying: 99, pressQualifying: 99, sources: [] }),
    );
    const answers = lying.secondPassAnswers!;
    const websiteQ = answers.find((a) => a.question.includes('Do 5 or more websites qualify'));
    const pressQ = answers.find((a) => a.question.includes('Do 4 or more press releases qualify'));
    const supportQ = answers.find((a) => a.question.includes('sufficient supporting public sources'));

    expect(websiteQ?.pass).toBe(false);
    expect(pressQ?.pass).toBe(false);
    expect(supportQ?.pass).toBe(false);
    expect(websiteQ?.detail).toContain('0 of 5');
  });

  it('re-derives conflicts and ambiguity from the records rather than the first pass verdict', () => {
    const withOpenConflict = evaluateReadiness(
      completeEntity({
        kind: 'second_pass',
        conflicts: [conflict({ severity: 'blocking', status: 'open' })],
      }),
    );
    const q = withOpenConflict.secondPassAnswers!.find((a) =>
      a.question.includes('unresolved contradictions or ambiguity'),
    );
    expect(q?.pass).toBe(false);

    const resolved = evaluateReadiness(
      completeEntity({
        kind: 'second_pass',
        conflicts: [conflict({ severity: 'blocking', status: 'resolved_by_user' })],
      }),
    );
    const ok = resolved.secondPassAnswers!.find((a) =>
      a.question.includes('unresolved contradictions or ambiguity'),
    );
    expect(ok?.pass).toBe(true);
  });

  it('never reports 100% while blocked', () => {
    // The second pass can flip a first-pass READY verdict to blocked. When it does, the score
    // must be re-clamped and the label rebuilt. A report reading "100% — BLOCKED" is exactly the
    // dishonest state the product forbids.
    const perturbations = [
      completeEntity({ kind: 'second_pass', claims: completeClaims().map((c) => ({ ...c, origin: 'user', user_confirmed: false })) }),
      completeEntity({ kind: 'second_pass', ambiguities: [ambiguity({ severity: 'blocking', status: 'open' })] }),
      completeEntity({ kind: 'second_pass', conflicts: [conflict({ severity: 'blocking', status: 'open' })] }),
    ];

    for (const input of perturbations) {
      const report = evaluateReadiness(input);
      if (report.status === 'blocked') {
        expect(report.score).toBeLessThan(100);
        expect(report.label).not.toContain('100%');
        expect(report.label).not.toContain('100');
      }
    }

    // And the specific historical defect, asserted directly rather than conditionally.
    const blocked = perturbations.map(evaluateReadiness).filter((r) => r.status === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);
    for (const report of blocked) {
      expect(report.score).toBeLessThanOrEqual(99);
    }
  });

  it('blocks when there is too little material for a whole-entity review to mean anything', () => {
    // The question "was the entire entity re-reviewed" used to hardcode `pass: true` and could
    // never fail for any input — a self-certification rather than a check. It now measures the
    // breadth of material actually re-examined.
    const empty = evaluateReadiness(
      completeEntity({
        kind: 'second_pass',
        claims: [],
        sources: [],
        photos: [],
        identityLinks: [],
        conflicts: [],
        ambiguities: [],
      }),
    );
    const breadth = empty.secondPassAnswers!.find((a) => a.question.includes('re-examined'));
    expect(breadth).toBeDefined();
    expect(breadth!.pass).toBe(false);
  });

  it('cannot report READY while any of its own answers failed', () => {
    const inputs = [
      completeEntity({ kind: 'second_pass' }),
      completeEntity({ kind: 'second_pass', websiteQualifying: 2 }),
      completeEntity({ kind: 'second_pass', photosQualifying: 1 }),
      completeEntity({ kind: 'second_pass', claims: completeClaims().map((c) => ({ ...c, origin: 'user', user_confirmed: false })) }),
      completeEntity({ kind: 'second_pass', ambiguities: [ambiguity({ severity: 'blocking', status: 'open' })] }),
    ];
    for (const input of inputs) {
      const report = evaluateReadiness(input);
      const failed = report.secondPassAnswers!.filter((a) => !a.pass);
      if (report.status === 'ready') expect(failed).toHaveLength(0);
      if (failed.length > 0) expect(report.status).not.toBe('ready');
    }
  });

  it('does not block an entity that has no self-asserted-only claims', () => {
    // Regression: the "Is important information unsupported or stale?" question had
    // `pass: false` hardcoded, so the second pass failed on every run regardless of the data.
    // A fully sourced entity was reported "100% — BLOCKED" with a blocking issue whose own
    // text said "0 claim(s) rest on the person's own assertion only" — i.e. it blocked the
    // entity for achieving exactly what the rule asks for.
    // Keep the full, complete claim set — this regression is about the provenance question
    // only. Replacing the whole claim set would break unrelated checks and hide the point.
    const fullySourced = completeEntity({
      kind: 'second_pass',
      claims: completeClaims().map((c) => ({ ...c, user_confirmed: true })),
    });
    const report = evaluateReadiness(fullySourced);
    const unsupported = report.secondPassAnswers!.find((a) =>
      a.question.includes('unsupported or stale'),
    );
    expect(unsupported).toBeDefined();
    expect(unsupported!.pass).toBe(true);
    expect(report.blockingIssues.some((b) => b.code === 'second_pass')).toBe(false);
    expect(report.status).toBe('ready');
  });

  it('still blocks when claims genuinely rest on the person alone', () => {
    const unconfirmed = completeEntity({
      kind: 'second_pass',
      // `origin` must be explicit: the question counts claims that are BOTH the person's own
    // (origin: user) AND unconfirmed. The default fixture leaves origin unset.
    claims: completeClaims().map((c) => ({ ...c, origin: 'user', user_confirmed: false })),
    });
    const report = evaluateReadiness(unconfirmed);
    const unsupported = report.secondPassAnswers!.find((a) =>
      a.question.includes('unsupported or stale'),
    );
    expect(unsupported!.pass).toBe(false);
    expect(unsupported!.answer).toBe('No');
  });

  it('reaches the same verdict for the same data, run to run', () => {
    const a = evaluateReadiness(completeEntity({ kind: 'second_pass' }));
    const b = evaluateReadiness(completeEntity({ kind: 'second_pass' }));
    expect(b.status).toBe(a.status);
    expect(b.score).toBe(a.score);
  });
});

describe('Entity Readiness: honesty guarantees', () => {
  it('names the Nexora Entity standard and never a search engine', () => {
    const report = evaluateReadiness(completeEntity());
    expect(report.summary).toContain('Nexora Entity');
    expect(report.summary.toLowerCase()).not.toContain('google');
    expect(report.label).not.toContain('Google');
    for (const issue of report.blockingIssues) expect(issue.detail.toLowerCase()).not.toContain('google');
  });

  it('keeps the disclaimer and the evidence-minimums notice on every report', () => {
    for (const kind of ['standard', 'second_pass'] as const) {
      const report = evaluateReadiness(completeEntity({ kind }));
      expect(report.disclaimer.length).toBeGreaterThan(0);
      expect(report.evidenceNotice.length).toBeGreaterThan(0);
    }
  });

  it('labels the evidence minimums as Nexora Entity standards, not external requirements', () => {
    const report = evaluateReadiness(completeEntity());
    expect(report.evidenceNotice).toContain('Nexora Entity internal');
    // The notices may name a search engine in order to rule it out, so the guarantee is that
    // they do not make a claim, not that the word never appears.
    expect(scanForProhibitedClaims(`${report.evidenceNotice} ${report.disclaimer}`)).toEqual([]);
  });

  it('keeps every user-visible string inside the permitted language', () => {
    for (const kind of ['standard', 'second_pass'] as const) {
      const report = evaluateReadiness(completeEntity({ kind }));
      const visible = [
        report.summary,
        report.label,
        report.disclaimer,
        report.evidenceNotice,
        ...report.blockingIssues.flatMap((b) => [b.title, b.detail, b.action]),
        ...report.checks.map((c) => `${c.label} ${c.detail}`),
        ...report.warnings.map((w) => `${w.title} ${w.detail}`),
        ...(report.secondPassAnswers ?? []).flatMap((a) => [a.question, a.answer, a.detail]),
      ];
      expect(scanForProhibitedClaims(visible.join(' '))).toEqual([]);
    }
  });

  it('returns every declared check with a readable detail, so the UI can render it all', () => {
    const report = evaluateReadiness(completeEntity());
    expect(report.checks.length).toBeGreaterThanOrEqual(20);
    for (const c of report.checks) {
      expect(['pass', 'fail', 'warn', 'skipped']).toContain(c.outcome);
      expect(c.detail.length).toBeGreaterThan(0);
      expect(c.weight).toBeGreaterThan(0);
    }
  });

  it('links a failed check to the stage that would fix it', () => {
    const report = evaluateReadiness(completeEntity({ websiteQualifying: 0, photosQualifying: 0 }));
    const siteCheck = checkById(report, 'websites_minimum_5');
    expect(siteCheck?.stageKey).toBe('N_websites');
    expect(checkById(report, 'photos_minimum_4')?.stageKey).toBe('Q_photos');
  });

  it('recomputes the counts rather than trusting the caller', () => {
    // A caller claiming 99 qualifying websites while supplying none must not pass the gate: the
    // engine derives its verdict from the source records in front of it.
    const report = evaluateReadiness(completeEntity({ websiteQualifying: 99, sources: [] }));
    expect(checkById(report, 'websites_minimum_5')?.outcome).toBe('fail');
    expect(report.status).toBe('blocked');
  });

  it('does not count a duplicate source towards a minimum', () => {
    // Six sources qualify, but two are flagged as duplicates of others, leaving four real
    // ones. The claimed count of 5 must not be taken at face value.
    const sources = completeSources().map((s, i) => (i === 1 || i === 2 ? { ...s, is_duplicate_of: 'other' } : s));
    const report = evaluateReadiness(completeEntity({ sources, websiteQualifying: 5 }));
    expect(report.checks.find((c) => c.id === 'websites_minimum_5')?.detail).toContain('4 of 5');
    expect(checkById(report, 'websites_minimum_5')?.outcome).toBe('fail');
  });
});

describe('Entity Readiness: material information', () => {
  it('blocks when a material stage has produced no data at all', () => {
    // Readiness judges the entity, not the wizard. A stage left untouched matters only
    // because its information is then missing.
    const withoutBio = completeEntity({
      claims: completeClaims().filter((c) => c.attribute_key !== 'about.biography'),
    });
    const report = evaluateReadiness(withoutBio);
    expect(report.status).toBe('blocked');
    expect(checkById(report, 'biography')?.outcome).toBe('fail');
    expect(report.blockingIssues.some((b) => b.checkId === 'biography')).toBe(true);
  });

  it('does not block on a descriptive gap the person left empty', () => {
    // Projects enrich the entity but cannot gate publication, so an empty projects stage is
    // reported, not enforced.
    const withoutProjects = completeEntity({
      claims: completeClaims().filter((c) => c.attribute_key !== 'projects.project'),
    });
    const report = evaluateReadiness(withoutProjects);
    expect(report.status).toBe('ready');
  });

  it('explains each gap in terms the person can act on', () => {
    const report = evaluateReadiness(completeEntity({ claims: completeClaims().filter((c) => c.attribute_key !== 'about.biography') }));
    for (const issue of report.blockingIssues) {
      expect(issue.detail.length).toBeGreaterThan(20);
      expect(issue.action.length).toBeGreaterThan(0);
    }
  });
});
