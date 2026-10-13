// Archived v2.12 (spec 9). Paste back into tools.ts on restore (README.md, Restore).
// Needs these imports in tools.ts:
//   import { SPONSOR_NOT_OPEN, escrowEnabled } from './escrow';
//   import { createSponsorDraft, prepareAward, sponsorStatus } from './sponsor';
//   import { AwardPicks, DraftInput, SponsorError } from './sponsor-rules';
// 1. Put SponsorCampaignInput (and Ref, if it is gone) next to the other tool inputs.
// 2. Put sponsorCampaign above the `tools` object.
// 3. Add `sponsor_campaign: sponsorCampaign,` to the `tools` object.

const Ref = z.string().regex(/^0x[0-9a-f]{64}$/, 'the ref from create');
export const SponsorCampaignInput = z.discriminatedUnion('action', [
  DraftInput.extend({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('status'), ref: Ref }).strict(),
  z
    .object({
      action: z.literal('award'),
      ref: Ref,
      ...AwardPicks,
    })
    .strict(),
]);


// Sponsors: create a campaign (returns a funding link and raw txs), check it (status reads the
// chain for the bound wallet's deposit or award), award it.
async function sponsorCampaign(input: unknown, ctx: ToolContext) {
  // Normally unreachable (the tool isn't registered until the escrow is configured).
  if (!escrowEnabled()) throw new SponsorError(SPONSOR_NOT_OPEN);
  const i = SponsorCampaignInput.parse(
    Object.fromEntries(
      Object.entries(input as object).filter(([, v]) => v !== undefined),
    ),
  );
  if (i.action === 'create') {
    const { action: _a, ...draft } = i;
    // Charged only once the draft (and any replaces) is valid; a replacement has its own cap.
    return createSponsorDraft(draft, ctx.installationId, (replacing) =>
      replacing
        ? enforce(
            'sponsorReplace',
            ctx.installationId,
            'This agent has replaced 10 sponsor drafts today, the daily limit.',
          )
        : enforce(
            'sponsorCreate',
            ctx.installationId,
            'This agent has created 5 sponsor campaigns today, the daily limit.',
          ),
    );
  }
  if (i.action === 'award')
    return prepareAward(i.ref, ctx.installationId, {
      winners: i.winners,
      split: i.split,
    });
  // status reads the chain (and may rescore entries).
  await enforce(
    'chainChecks',
    ctx.installationId,
    'Too many status checks from this agent.',
  );
  return sponsorStatus(i.ref, ctx.installationId);
}

