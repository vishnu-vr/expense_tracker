import { AgentBackend } from "../src/agent/backend";
import { normalizeNote } from "../src/core/merchant";
import { ProposalDraft } from "../src/core/proposals";
import { HomeData } from "../src/core/types";
import { ASHA, fixtureHomeData } from "./fixture";

/**
 * In-memory tool backend over the fixture household — no Firestore, no
 * embeddings. `searchNotes` is a simple word-overlap ranking standing in for
 * vector search (which needs Vertex AI + Firestore); proposals are kept in memory.
 */
export class FixtureBackend implements AgentBackend {
  readonly uid: string;
  readonly proposals: (ProposalDraft & { id: string })[] = [];
  private readonly data: HomeData;

  constructor(uid: string = ASHA, data: HomeData = fixtureHomeData()) {
    this.uid = uid;
    this.data = data;
  }

  async loadData(): Promise<HomeData> {
    return this.data;
  }

  async searchNotes(query: string, limit: number): Promise<{ transactionId: string; score: number }[]> {
    const words = normalizeNote(query).split(" ").filter((w) => w.length > 2);
    if (words.length === 0) return [];
    return this.data.transactions
      .map((t) => {
        const note = normalizeNote(t.note);
        const hits = words.filter((w) => note.includes(w)).length;
        return { transactionId: t.id, score: hits / words.length, time: t.date.getTime() };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.time - a.time)
      .slice(0, limit)
      .map(({ transactionId, score }) => ({ transactionId, score }));
  }

  async createProposal(draft: ProposalDraft): Promise<string> {
    const id = `proposal_${this.proposals.length + 1}`;
    this.proposals.push({ ...draft, id });
    return id;
  }
}
