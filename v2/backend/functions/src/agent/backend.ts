import { ProposalDraft } from "../core/proposals";
import { HomeData } from "../core/types";

/**
 * Everything the agent's tools need from the outside world. The Cloud
 * Function supplies a Firestore-backed implementation whose home is resolved
 * from the caller's `users/{uid}` doc; the eval harness supplies an in-memory
 * one. The model never chooses the household.
 */
export interface AgentBackend {
  /** The signed-in caller. */
  readonly uid: string;
  /** The caller's household data (cached for the duration of one question). */
  loadData(): Promise<HomeData>;
  /** Semantic search over transaction notes; returns transaction ids, best first. */
  searchNotes(query: string, limit: number): Promise<{ transactionId: string; score: number }[]>;
  /** Store a pending proposal and return its id. Must not touch user data. */
  createProposal(draft: ProposalDraft): Promise<string>;
}
