export interface CityContext {
  id: string;
  slug: string;
  nameEn: string;
  timezone: string;
  serviceDayCutoffTime: string;
  countryCode: string;
}

export interface EventSummary {
  event_id: string;
  name: string;
  date: string;
  service_date: string | null;
  venue: {
    id: string;
    name: string;
    area: string | null;
  };
  performers: string[];
  genres: string[];
  price: string | null;
  flyer_url: string | null;
  nlt_url: string;
}

export interface EventDetail {
  event_id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  service_date: string | null;
  venue: {
    id: string;
    name: string;
    area: string | null;
    address: string | null;
    map_link: string | null;
    website: string | null;
  };
  lineup: Array<{
    stage: string | null;
    performer_name: string;
    start_time: string | null;
    end_time: string | null;
  }>;
  genres: string[];
  price: {
    entrance_summary: string | null;
    door: string | null;
    advance: string | null;
    tiers: Array<{
      tier_name: string;
      price: number | null;
      currency: string | null;
      status: string;
      url: string | null;
      provider: string | null;
    }>;
  };
  flyer_url: string | null;
  guest_list_status: "available" | "full" | "closed";
  nlt_url: string;
}

export interface CityUnavailable {
  requested_city: string;
  message: string;
  available_cities: string[];
  request_city_url: string;
}

export type ModalTimeBucket = "early" | "prime" | "late";

export interface Recommendation {
  rank: number;
  modal_id: string;
  modal_name: string;
  modal_description: string;
  event: EventSummary;
  why_this_fits: string[];
}

export interface RecommendationsOutput {
  city: string;
  date_filter: string | null;
  result_count: number;
  recommendations: Recommendation[];
  unavailable_city: CityUnavailable | null;
}

export interface VenueSummary {
  venue_id: string;
  name: string;
  area: string | null;
  address: string | null;
  website: string | null;
  image_url: string | null;
  vip_booking_supported: boolean;
  upcoming_event_count: number;
  next_event_date: string | null;
  genres: string[];
  nlt_url: string;
}

export interface VenueDetail {
  venue_id: string;
  name: string;
  area: string | null;
  address: string | null;
  website: string | null;
  image_url: string | null;
  vip_booking_supported: boolean;
  sns_instagram: string | null;
  sns_tiktok: string | null;
  sns_x: string | null;
  sns_youtube: string | null;
  guest_list_enabled: boolean | null;
  upcoming_event_count: number;
  upcoming_events: EventSummary[];
  nlt_url: string;
}

export interface SearchVenuesOutput {
  city: string;
  date_filter: string | null;
  venues: VenueSummary[];
  unavailable_city: CityUnavailable | null;
}

export interface PerformerSummary {
  performer_id: string;
  name: string;
  slug: string | null;
  follower_count: number | null;
  ranking_score: number | null;
  genres: string[];
  image_url: string | null;
  has_upcoming_event: boolean;
  next_event_date: string | null;
  nlt_url: string;
}

export interface PerformerUpcomingEvent {
  event: EventSummary;
  stage: string | null;
  set_start_time: string | null;
  set_end_time: string | null;
}

export interface PerformerDetail {
  performer_id: string;
  name: string;
  slug: string | null;
  bio: string | null;
  follower_count: number | null;
  ranking_score: number | null;
  genres: string[];
  image_url: string | null;
  social_links: Array<{
    platform: string;
    username: string;
    url: string | null;
  }>;
  upcoming_events: PerformerUpcomingEvent[];
  nlt_url: string;
}

export interface SearchPerformersOutput {
  city: string;
  date_filter: string | null;
  performers: PerformerSummary[];
  unavailable_city: CityUnavailable | null;
}

export interface UnmetRequestResult {
  request_id: string;
  status: string;
  created_at: string;
}

export type VipBookingStatus =
  | "submitted"
  | "in_review"
  | "confirmed"
  | "rejected"
  | "cancelled";

export interface VipBookingCreateResult {
  booking_request_id: string;
  status: VipBookingStatus;
  created_at: string;
  message: string;
}

export interface VipBookingStatusHistoryEntry {
  status: VipBookingStatus;
  at: string;
  note: string | null;
}

export interface VipBookingStatusResult {
  booking_request_id: string;
  status: VipBookingStatus;
  last_updated_at: string;
  status_message: string;
  latest_note: string | null;
  history: VipBookingStatusHistoryEntry[];
}

export interface VipBookingTransitionResult {
  booking_request_id: string;
  status: VipBookingStatus;
  last_updated_at: string;
  status_message: string;
}

export interface VipAgentTaskClaim {
  task_id: string;
  booking_request_id: string;
  attempt_count: number;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  current_status: VipBookingStatus;
}

export interface VipAlertTask {
  task_id: string;
  booking_request_id: string;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  venue_id: string;
  venue_name: string | null;
  current_status: VipBookingStatus;
  request_created_at: string;
  first_alerted_at: string | null;
  last_alerted_at: string | null;
  alert_count: number;
  escalated_at: string | null;
  should_escalate: boolean;
}

export interface VipAlertListResult {
  now: string;
  tasks: VipAlertTask[];
}

export interface VipAlertMarkResult {
  task_id: string;
  status: "pending";
  first_alerted_at: string | null;
  last_alerted_at: string | null;
  alert_count: number;
  escalated_at: string | null;
  next_attempt_at: string;
}

export interface VipAcknowledgeClaimResult {
  task_id: string;
  task_status: "done";
  booking_request_id: string;
  booking_status: VipBookingStatus;
  booking_status_message: string;
  booking_updated_at: string;
  acknowledged_by: string | null;
  acknowledged_channel: string | null;
  acknowledged_session: string | null;
  acknowledged_at: string | null;
}

export type VipAgentTaskStatus = "pending" | "claimed" | "done" | "failed";

export interface VipReservationLatestTask {
  task_id: string;
  status: VipAgentTaskStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  alert_count: number | null;
  last_alerted_at: string | null;
  updated_at: string;
}

export interface VipReservationSummary {
  booking_request_id: string;
  status: VipBookingStatus;
  status_message: string;
  booking_date: string;
  arrival_time: string;
  party_size: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  special_requests: string | null;
  venue_id: string;
  venue_name: string | null;
  created_at: string;
  updated_at: string;
  latest_event_note: string | null;
  latest_event_at: string | null;
  latest_event_actor_type: "customer" | "agent" | "ops" | "system" | null;
  latest_task: VipReservationLatestTask | null;
}

export interface VipReservationListResult {
  now: string;
  count: number;
  statuses: VipBookingStatus[];
  reservations: VipReservationSummary[];
}

export type VipTableStatus =
  | "available"
  | "held"
  | "booked"
  | "blocked"
  | "unknown";

export interface VipTableAvailabilityTable {
  table_id: string;
  table_code: string;
  table_name: string;
  zone: string | null;
  capacity_min: number | null;
  capacity_max: number | null;
  status: VipTableStatus;
  min_spend: number | null;
  currency: string | null;
  note: string | null;
  pricing_approximate: boolean;
}

export interface VipTableAvailabilityDay {
  booking_date: string;
  available_count: number;
  total_count: number;
  tables: VipTableAvailabilityTable[];
}

export interface VipTableAvailabilityResult {
  venue_id: string;
  venue_name: string | null;
  booking_date_from: string;
  booking_date_to: string;
  party_size: number | null;
  generated_at: string;
  days: VipTableAvailabilityDay[];
}

export interface VipTableChartNode {
  table_id: string;
  table_code: string;
  table_name: string;
  zone: string | null;
  capacity_min: number | null;
  capacity_max: number | null;
  is_active: boolean;
  sort_order: number;
  chart_shape: string;
  chart_x: number | null;
  chart_y: number | null;
  chart_width: number | null;
  chart_height: number | null;
  chart_rotation: number | null;
  status: VipTableStatus | null;
  min_spend: number | null;
  currency: string | null;
  note: string | null;
  pricing_approximate: boolean;
}

export interface VipTableChartResult {
  venue_id: string;
  venue_name: string | null;
  booking_date: string | null;
  layout_image_url: string | null;
  generated_at: string;
  tables: VipTableChartNode[];
}

export interface VipVenueTableMutationItem {
  table_id: string;
  table_code: string;
}

export interface VipVenueTableMutationResult {
  venue_id: string;
  venue_name: string | null;
  updated_count: number;
  tables: VipVenueTableMutationItem[];
}

export interface VipTableAvailabilityMutationResult {
  venue_id: string;
  venue_name: string | null;
  booking_date: string;
  updated_count: number;
}

export interface VipTableDayDefaultMutationResult {
  venue_id: string;
  venue_name: string | null;
  updated_count: number;
  tables: Array<{
    table_code: string;
    days_set: number;
  }>;
}

export interface VipTableChartImageUploadResult {
  venue_id: string;
  venue_name: string | null;
  storage_bucket: string;
  storage_path: string;
  layout_image_url: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}
