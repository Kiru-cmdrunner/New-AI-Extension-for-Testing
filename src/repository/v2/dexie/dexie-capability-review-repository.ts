/**
 * Dexie Capability Review Repository — persistence for CapabilityReview entities.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §11 Step 4
 */

import type { CapabilityReview, CapabilityReviewState } from '../../../domain/entities/capability-review';
import type { Table } from 'dexie';

export interface CapabilityReviewRepository {
  getByReviewId(reviewId: string): Promise<CapabilityReview | undefined>;
  getBySessionId(sessionId: string): Promise<CapabilityReview[]>;
  getByState(state: CapabilityReviewState): Promise<CapabilityReview[]>;
  getPending(): Promise<CapabilityReview[]>;
  create(review: CapabilityReview): Promise<CapabilityReview>;
  update(review: CapabilityReview): Promise<CapabilityReview>;
  delete(reviewId: string): Promise<void>;
}

export class DexieCapabilityReviewRepository implements CapabilityReviewRepository {
  constructor(private readonly reviews: Table<CapabilityReview, string>) {}

  async getByReviewId(reviewId: string): Promise<CapabilityReview | undefined> {
    return this.reviews.get(reviewId);
  }

  async getBySessionId(sessionId: string): Promise<CapabilityReview[]> {
    return this.reviews.where('sessionId').equals(sessionId).toArray();
  }

  async getByState(state: CapabilityReviewState): Promise<CapabilityReview[]> {
    return this.reviews.where('state').equals(state).toArray();
  }

  async getPending(): Promise<CapabilityReview[]> {
    return this.getByState('pending');
  }

  async create(review: CapabilityReview): Promise<CapabilityReview> {
    await this.reviews.add(review);
    return review;
  }

  async update(review: CapabilityReview): Promise<CapabilityReview> {
    await this.reviews.put(review);
    return review;
  }

  async delete(reviewId: string): Promise<void> {
    await this.reviews.delete(reviewId);
  }
}
