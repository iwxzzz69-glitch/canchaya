export type Role = 'player' | 'owner' | 'admin';
export type Sport = 'football' | 'volleyball' | 'padel' | 'basketball';
export type Level = 'casual' | 'intermediate' | 'advanced';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface User { id: string; email: string; name: string; role: Role }
export interface Session { accessToken: string; user: User }

export interface Court { id: string; name: string; sport: Sport; pricePerHour: number; openHour: number; closeHour: number }
export interface Rating { average: number | null; count: number }
export interface Venue { id: string; name: string; description: string | null; address: string; zone: string; courts: Court[]; rating: Rating }
export interface Page<T> { data: T[]; total: number; page: number; limit: number }

export interface Slot { startsAt: string; endsAt: string; available: boolean }
export interface Availability { courtId: string; date: string; pricePerHour: number; slots: Slot[] }

export interface Booking {
  id: string; status: BookingStatus; startsAt: string; endsAt: string; totalPrice: number;
  expiresAt: string | null; matchId: string | null; reviewed: boolean;
  court: { id: string; name: string; sport: Sport };
  venue: { id: string; name: string; address: string; zone: string };
}

export interface Match {
  id: string; status: 'open' | 'cancelled'; level: Level; notes: string | null; organizer: string; sport: Sport;
  startsAt: string; endsAt: string; spotsTotal: number; spotsTaken: number; spotsLeft: number; suggestedPricePerPlayer: number;
  court: { id: string; name: string };
  venue: { id: string; name: string; address: string; zone: string };
  players?: { name: string; joinedAt: string }[];
  role?: 'organizer' | 'player';
}

export interface Review { id: string; rating: number; comment: string | null; author: string; createdAt: string }
export interface ReviewPage { data: Review[]; total: number; average: number | null }

export interface PaymentResult { booking: { id: string; status: BookingStatus }; payment: { id: string; status: string; amount: number } }

export interface RoomMember { id: string; name: string }
export interface Room {
  id: string;
  kind: 'booking' | 'match';
  status: 'open' | 'closed';
  playerId: string;
  ownerId: string | null;
  memberIds: string[];
  members: RoomMember[];
  venueName: string;
  courtName: string;
  startsAt: string;
  endsAt: string;
}
export interface ChatMessage { id: string; roomId: string; senderId: string; kind: 'user' | 'system'; text: string; createdAt: string }
