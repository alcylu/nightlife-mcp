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

