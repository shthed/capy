import { SAMPLE_GALLERY, SampleArtwork } from '../../types';
import { randomHexId } from '../auth/AuthManager';
import { SafeLocalStore } from '../storage/SafeLocalStore';
import { AI_CREDITS_STORAGE_KEY, COMMUNITY_IDEAS_STORAGE_KEY } from '../storage/StorageKeys';
import { reportSwallowed } from '../telemetry';
import {
  AiArtworkProvider,
  AiCreditLedger,
  CatalogStorageProvider,
  CommunityPuzzleIdea,
  InfiniteZoomTileSpec,
  MonetizationProvider,
  PlayerIdentity,
} from '../providers/types';

export const BLOCKED_PROMPT_PATTERNS = [
  /\b(nsfw|nude|nudity|explicit|gore|blood|violence|weapon|hate|slur)\b/i,
];

const SEED_COMMUNITY_IDEAS: CommunityPuzzleIdea[] = [
  {
    id: 'idea_onsen_yuzu',
    title: 'Hot Spring Capybaras in Winter Snow',
    prompt:
      'Cozy capybaras relaxing in a steaming cedar hot spring with floating yuzu citrus and falling snow, clean cel-shaded illustration',
    category: 'Animals',
    tags: ['Animals', 'Cozy', 'Nature'],
    authorName: 'River Capy',
    authorId: 'seed_1',
    votes: 0,
    votedByMe: false,
    status: 'curated',
    createdAt: 1730000000000,
  },
  {
    id: 'idea_clockwork_terrarium',
    title: 'Botanical Glass Terrarium',
    prompt:
      'Detailed stained-glass style botanical terrarium filled with glowing ferns, succulents, and tiny snails, crisp ink line art',
    category: 'Coloring',
    tags: ['Coloring', 'Line Art', 'Nature'],
    authorName: 'Forest Sprout',
    authorId: 'seed_2',
    votes: 0,
    votedByMe: false,
    status: 'queued',
    createdAt: 1730100000000,
  },
];

export class StaticAndCommunityCatalogAdapter implements CatalogStorageProvider {
  async getGalleryItems(): Promise<SampleArtwork[]> {
    return SAMPLE_GALLERY;
  }

  getCommunityIdeas(): CommunityPuzzleIdea[] {
    try {
      const raw = SafeLocalStore.getScopedItem(COMMUNITY_IDEAS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CommunityPuzzleIdea[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed
            .filter(
              (item): item is CommunityPuzzleIdea =>
                Boolean(
                  item &&
                    typeof item === 'object' &&
                    typeof item.id === 'string' &&
                    typeof item.title === 'string' &&
                    typeof item.prompt === 'string'
                )
            )
            .map((idea) => ({
              ...idea,
              votes: 0,
              votedByMe: false,
              createdAt:
                typeof idea.createdAt === 'number' && Number.isFinite(idea.createdAt)
                  ? idea.createdAt
                  : 0,
            }));
          if (valid.length > 0) {
            return valid.sort((a, b) => b.createdAt - a.createdAt);
          }
        }
      }
    } catch (err) {
      reportSwallowed('CatalogIdeasService.getCommunityIdeas', err);
    }
    return [...SEED_COMMUNITY_IDEAS].sort((a, b) => b.createdAt - a.createdAt);
  }

  private saveIdeas(ideas: CommunityPuzzleIdea[]): void {
    try {
      SafeLocalStore.setScopedItem(COMMUNITY_IDEAS_STORAGE_KEY, JSON.stringify(ideas));
    } catch (err) {
      reportSwallowed('CatalogIdeasService.saveIdeas', err);
    }
  }

  submitCommunityIdea(input: {
    title: string;
    prompt: string;
    category: string;
    tags?: string[];
    author: PlayerIdentity;
  }): { ok: true; idea: CommunityPuzzleIdea } | { ok: false; error: string } {
    const cleanTitle = input.title.trim().slice(0, 60);
    const cleanPrompt = input.prompt.trim().slice(0, 280);
    if (cleanTitle.length < 3) {
      return { ok: false, error: 'Please enter a puzzle title (at least 3 characters).' };
    }
    if (cleanPrompt.length < 10) {
      return { ok: false, error: 'Please describe your puzzle idea (at least 10 characters).' };
    }

    const combinedText = `${cleanTitle} ${cleanPrompt}`;
    for (const pattern of BLOCKED_PROMPT_PATTERNS) {
      if (pattern.test(combinedText)) {
        return {
          ok: false,
          error: 'Please keep puzzle ideas family-friendly and suitable for all ages.',
        };
      }
    }

    const existing = this.getCommunityIdeas();
    const newIdea: CommunityPuzzleIdea = {
      id: `idea_${Date.now()}_${randomHexId(4)}`,
      title: cleanTitle,
      prompt: cleanPrompt,
      category: input.category || 'Community',
      tags: input.tags && input.tags.length > 0 ? input.tags : [input.category || 'Community'],
      authorName: input.author.displayName,
      authorId: input.author.playerId,
      votes: 0,
      votedByMe: false,
      status: 'queued',
      createdAt: Date.now(),
    };

    const updated = [newIdea, ...existing];
    this.saveIdeas(updated);
    return { ok: true, idea: newIdea };
  }

  toggleVoteIdea(_ideaId: string): CommunityPuzzleIdea[] {
    const normalized = this.getCommunityIdeas();
    this.saveIdeas(normalized);
    return normalized;
  }
}

export class DefaultAiArtworkAdapter implements AiArtworkProvider {
  readonly isConfigured = Boolean(
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CAPY_AI_API_URL
  );

  estimateCreditCost(resolution: number, isInfiniteZoomInfill: boolean): number {
    if (isInfiniteZoomInfill) return 1;
    return resolution > 1280 ? 2 : 1;
  }

  buildSeamLockedInfillPrompt(spec: InfiniteZoomTileSpec): string {
    const paletteList = spec.lockedBoundaryPaletteHex.slice(0, 8).join(', ');
    return [
      `Seamless zoom-in detail sub-tile (depth ${spec.depth}, quadrant ${spec.quadrant + 1})`,
      spec.promptHint.trim() || 'clean color-by-number cel illustration with clear bounded regions',
      paletteList
        ? `locking outer border colors to [${paletteList}] for invisible parent tile seams`
        : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
}

function formatExtendedSidesLabel(sides?: InfiniteZoomTileSpec['extendedSides']): string {
  if (!sides) return 'selected borders';
  const active = (['top', 'bottom', 'left', 'right'] as const).filter((side) => sides[side]);
  return active.length > 0 ? active.join(', ') : 'selected borders';
}

export class LocalBrowserAiArtworkAdapter implements AiArtworkProvider {
  readonly isConfigured = true;

  estimateCreditCost(_resolution: number, _isInfiniteZoomInfill: boolean): number {
    return 0;
  }

  buildSeamLockedInfillPrompt(spec: InfiniteZoomTileSpec): string {
    const direction = spec.direction ?? 'child-in';
    let modeLead: string;
    if (direction === 'in-place') {
      const regionCount = spec.selectedRegionIds?.length ?? 0;
      const regionClause = regionCount > 0 ? `, ${regionCount} selected regions` : '';
      modeLead = `Seamless in-place region detail subdivision (depth ${spec.depth}${regionClause})`;
    } else if (direction === 'extend-out') {
      const sidesLabel = formatExtendedSidesLabel(spec.extendedSides);
      modeLead = `Seamless outward border extension (depth ${spec.depth}, sides: ${sidesLabel})`;
    } else {
      modeLead = `Seamless zoom-in detail sub-tile (depth ${spec.depth}, quadrant ${spec.quadrant + 1})`;
    }

    const hint =
      spec.promptHint.trim().slice(0, 200) ||
      'clean color-by-number cel illustration with clear bounded regions';
    const paletteList = spec.lockedBoundaryPaletteHex.slice(0, 8).join(', ');
    const seamClause = paletteList
      ? `locking seam boundary colors to [${paletteList}] for seamless continuity`
      : '';

    return [modeLead, hint, seamClause].filter(Boolean).join(', ');
  }
}

export class NoOpMonetizationAdapter implements MonetizationProvider {
  getLedger(): AiCreditLedger {
    try {
      const raw = SafeLocalStore.getScopedItem(AI_CREDITS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AiCreditLedger>;
        const nonNegInt = (v: unknown, fallback: number) =>
          typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
        return {
          availableCredits: nonNegInt(parsed.availableCredits, 3),
          lifetimeEarnedCredits: nonNegInt(parsed.lifetimeEarnedCredits, 3),
          lifetimeSpentCredits: nonNegInt(parsed.lifetimeSpentCredits, 0),
          adFreePlatform: true,
          personalizedAdsConsent: false,
        };
      }
    } catch (err) {
      reportSwallowed('NoOpMonetizationAdapter.getLedger', err);
    }
    return {
      availableCredits: 3, // Starter free AI generation credits
      lifetimeEarnedCredits: 3,
      lifetimeSpentCredits: 0,
      adFreePlatform: true,
      personalizedAdsConsent: false,
    };
  }

  private saveLedger(ledger: AiCreditLedger): void {
    try {
      SafeLocalStore.setScopedItem(AI_CREDITS_STORAGE_KEY, JSON.stringify(ledger));
    } catch (err) {
      reportSwallowed('NoOpMonetizationAdapter.saveLedger', err);
    }
  }

  setPersonalizedAdsConsent(_consent: boolean): AiCreditLedger {
    const next: AiCreditLedger = {
      ...this.getLedger(),
      adFreePlatform: true,
      personalizedAdsConsent: false,
    };
    this.saveLedger(next);
    return next;
  }

  async watchRewardedAdForCredits(): Promise<{ granted: number; ledger: AiCreditLedger }> {
    const current = this.getLedger();
    // 100% ad-free across all platforms; no ad SDK is bundled
    const next: AiCreditLedger = {
      ...current,
      adFreePlatform: true,
      personalizedAdsConsent: false,
    };
    this.saveLedger(next);
    return { granted: 0, ledger: next };
  }

  spendCredits(amount: number): boolean {
    const current = this.getLedger();
    if (amount <= 0) return true;
    if (current.availableCredits < amount) return false;
    this.saveLedger({
      ...current,
      availableCredits: current.availableCredits - amount,
      lifetimeSpentCredits: current.lifetimeSpentCredits + amount,
    });
    return true;
  }
}

export { StaticAndCommunityCatalogAdapter as CatalogIdeasService };
export { NoOpMonetizationAdapter as ConsentRewardedAdAdapter };
