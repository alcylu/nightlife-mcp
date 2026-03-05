import type { SupabaseClient } from "@supabase/supabase-js";
import { NightlifeError } from "../errors.js";

type SubmitInput = {
  event_id?: string;
  venue_id?: string;
  service_date?: string;
  customer_name: string;
  party_size: number;
  customer_email: string;
  customer_phone?: string;
  messaging_channel?: string;
  messaging_handle?: string;
  language: string;
  source: string;
};

type SubmitOutput = {
  entry_id: string;
  status: "confirmed" | "full" | "closed";
  event_name: string | null;
  event_date: string | null;
  message: string;
  guest_list_benefit: string | null;
  door_instructions: string | null;
};

type StatusInput = {
  entry_id?: string;
  event_id?: string;
  customer_email?: string;
};

type StatusOutput = {
  entry_id: string;
  status: "confirmed" | "cancelled";
  customer_name: string;
  party_size: number;
  event_name: string | null;
  event_date: string | null;
  created_at: string;
  guest_list_benefit: string | null;
  door_instructions: string | null;
};

type GuestListSettings = {
  enabled: boolean | null;
  capacity: number | null;
  cutoff_time: string | null;
  benefit_en: string | null;
  door_instructions_en: string | null;
  confirmation_message_en: string | null;
};

async function resolveEventContext(
  supabase: SupabaseClient,
  eventId?: string,
  venueId?: string,
  serviceDate?: string,
): Promise<{
  event_day_id: string | null;
  venue_id: string | null;
  service_date: string | null;
  event_name: string | null;
  event_date: string | null;
}> {
  if (eventId) {
    // Look up event_occurrence_days for this event
    const { data: eventDay, error } = await supabase
      .from("event_occurrence_days")
      .select(`
        id,
        service_date,
        venue_id,
        event_occurrence_id,
        event_occurrences!inner (
          event_id,
          events!inner (
            name_en
          )
        )
      `)
      .eq("event_occurrence_id", eventId)
      .order("service_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", `Failed to look up event: ${error.message}`);
    }

    if (!eventDay) {
      // Try as event_occurrence_day ID directly
      const { data: dayDirect, error: dayError } = await supabase
        .from("event_occurrence_days")
        .select(`
          id,
          service_date,
          venue_id,
          event_occurrences!inner (
            event_id,
            events!inner (
              name_en
            )
          )
        `)
        .eq("id", eventId)
        .maybeSingle();

      if (dayError || !dayDirect) {
        throw new NightlifeError("EVENT_NOT_FOUND", `Event not found: ${eventId}`);
      }

      const eventName = (dayDirect as any).event_occurrences?.events?.name_en ?? null;

      return {
        event_day_id: dayDirect.id,
        venue_id: dayDirect.venue_id,
        service_date: dayDirect.service_date,
        event_name: eventName,
        event_date: dayDirect.service_date,
      };
    }

    const eventName = (eventDay as any).event_occurrences?.events?.name_en ?? null;

    return {
      event_day_id: eventDay.id,
      venue_id: eventDay.venue_id,
      service_date: eventDay.service_date,
      event_name: eventName,
      event_date: eventDay.service_date,
    };
  }

  if (venueId && serviceDate) {
    // Look for event on this date at this venue
    const { data: eventDay } = await supabase
      .from("event_occurrence_days")
      .select(`
        id,
        service_date,
        venue_id,
        event_occurrences!inner (
          event_id,
          events!inner (
            name_en
          )
        )
      `)
      .eq("venue_id", venueId)
      .eq("service_date", serviceDate)
      .limit(1)
      .maybeSingle();

    if (eventDay) {
      const eventName = (eventDay as any).event_occurrences?.events?.name_en ?? null;
      return {
        event_day_id: eventDay.id,
        venue_id: eventDay.venue_id,
        service_date: eventDay.service_date,
        event_name: eventName,
        event_date: eventDay.service_date,
      };
    }

    // No event found — use venue-level guest list (virtual)
    return {
      event_day_id: null,
      venue_id: venueId,
      service_date: serviceDate,
      event_name: null,
      event_date: serviceDate,
    };
  }

  throw new NightlifeError(
    "INVALID_REQUEST",
    "Must provide either event_id or venue_id + service_date",
  );
}

async function loadGuestListSettings(
  supabase: SupabaseClient,
  eventDayId: string | null,
  venueId: string | null,
): Promise<GuestListSettings | null> {
  // Try event-specific settings first
  if (eventDayId) {
    const { data: eventSettings } = await supabase
      .from("event_guest_list_settings")
      .select("enabled, capacity, cutoff_time, benefit_en, door_instructions_en, confirmation_message_en")
      .eq("event_day_id", eventDayId)
      .maybeSingle();

    if (eventSettings) {
      // If event has explicit enabled=false, guest list is disabled
      if (eventSettings.enabled === false) {
        return { ...eventSettings, enabled: false };
      }
      // If event has explicit enabled=true, use event settings
      if (eventSettings.enabled === true) {
        return eventSettings;
      }
      // enabled is null — fall through to venue settings and merge
    }
  }

  // Fall back to venue-level settings
  if (venueId) {
    const { data: venueSettings } = await supabase
      .from("event_guest_list_settings")
      .select("enabled, capacity, cutoff_time, benefit_en, door_instructions_en, confirmation_message_en")
      .eq("venue_id", venueId)
      .is("event_day_id", null)
      .maybeSingle();

    if (venueSettings) {
      return venueSettings;
    }
  }

  return null;
}

async function countExistingEntries(
  supabase: SupabaseClient,
  eventDayId: string | null,
  venueId: string | null,
  serviceDate: string | null,
): Promise<number> {
  let query = supabase
    .from("event_guest_list_entries")
    .select("id", { count: "exact", head: true });

  if (eventDayId) {
    query = query.eq("event_day_id", eventDayId);
  } else if (venueId && serviceDate) {
    query = query.eq("venue_id", venueId).eq("service_date", serviceDate);
  } else {
    return 0;
  }

  const { count, error } = await query;
  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", `Failed to count entries: ${error.message}`);
  }

  return count ?? 0;
}

async function checkDuplicate(
  supabase: SupabaseClient,
  email: string,
  eventDayId: string | null,
  venueId: string | null,
  serviceDate: string | null,
): Promise<boolean> {
  let query = supabase
    .from("event_guest_list_entries")
    .select("id")
    .eq("email", email.toLowerCase());

  if (eventDayId) {
    query = query.eq("event_day_id", eventDayId);
  } else if (venueId && serviceDate) {
    query = query.eq("venue_id", venueId).eq("service_date", serviceDate);
  }

  const { data } = await query.limit(1).maybeSingle();
  return data !== null;
}

export async function submitToGuestList(
  supabase: SupabaseClient,
  input: SubmitInput,
): Promise<SubmitOutput> {
  // 1. Resolve event context
  const ctx = await resolveEventContext(
    supabase,
    input.event_id,
    input.venue_id,
    input.service_date,
  );

  // 2. Load guest list settings
  const settings = await loadGuestListSettings(supabase, ctx.event_day_id, ctx.venue_id);

  if (!settings || settings.enabled === false) {
    throw new NightlifeError(
      "GUEST_LIST_NOT_AVAILABLE",
      "Guest list is not available for this event",
    );
  }

  // 3. Check cutoff time
  if (settings.cutoff_time && ctx.service_date) {
    const now = new Date();
    const tokyoFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const nowParts = tokyoFormatter.formatToParts(now);
    const nowHour = Number(nowParts.find((p) => p.type === "hour")?.value ?? 0);
    const nowMinute = Number(nowParts.find((p) => p.type === "minute")?.value ?? 0);
    const nowMinutes = nowHour * 60 + nowMinute;

    const [cutoffH, cutoffM] = settings.cutoff_time.split(":").map(Number);
    const cutoffMinutes = cutoffH * 60 + cutoffM;

    // Only check cutoff if the service date is today
    const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });
    const todayStr = dateFormatter.format(now);
    if (ctx.service_date === todayStr && nowMinutes >= cutoffMinutes) {
      return {
        entry_id: "",
        status: "closed",
        event_name: ctx.event_name,
        event_date: ctx.event_date,
        message: "Guest list has closed for tonight. Consider VIP table booking instead.",
        guest_list_benefit: null,
        door_instructions: null,
      };
    }
  }

  // 4. Check capacity
  if (settings.capacity) {
    const currentCount = await countExistingEntries(
      supabase,
      ctx.event_day_id,
      ctx.venue_id,
      ctx.service_date,
    );
    if (currentCount >= settings.capacity) {
      return {
        entry_id: "",
        status: "full",
        event_name: ctx.event_name,
        event_date: ctx.event_date,
        message: "Guest list is full for this event. Consider VIP table booking instead.",
        guest_list_benefit: null,
        door_instructions: null,
      };
    }
  }

  // 5. Check duplicate
  const isDuplicate = await checkDuplicate(
    supabase,
    input.customer_email,
    ctx.event_day_id,
    ctx.venue_id,
    ctx.service_date,
  );
  if (isDuplicate) {
    throw new NightlifeError(
      "GUEST_LIST_DUPLICATE",
      "This email is already on the guest list for this event",
    );
  }

  // 6. Insert entry
  const insertData: Record<string, unknown> = {
    email: input.customer_email.toLowerCase(),
    name: input.customer_name,
    group_size: input.party_size,
    language: input.language,
    source: input.source,
  };

  if (input.customer_phone) insertData.messaging_handle = input.customer_phone;
  if (input.messaging_channel) insertData.messaging_channel = input.messaging_channel;
  if (input.messaging_handle) insertData.messaging_handle = input.messaging_handle;
  if (ctx.event_day_id) insertData.event_day_id = ctx.event_day_id;
  if (ctx.venue_id) insertData.venue_id = ctx.venue_id;
  if (ctx.service_date) insertData.service_date = ctx.service_date;

  const { data: entry, error } = await supabase
    .from("event_guest_list_entries")
    .insert(insertData)
    .select("id, created_at")
    .single();

  if (error) {
    throw new NightlifeError("DB_QUERY_FAILED", `Failed to create guest list entry: ${error.message}`);
  }

  const message = settings.confirmation_message_en
    || "You're on the guest list! Show this confirmation at the door.";

  return {
    entry_id: entry.id,
    status: "confirmed",
    event_name: ctx.event_name,
    event_date: ctx.event_date,
    message,
    guest_list_benefit: settings.benefit_en ?? null,
    door_instructions: settings.door_instructions_en ?? null,
  };
}

export async function getGuestListEntryStatus(
  supabase: SupabaseClient,
  input: StatusInput,
): Promise<StatusOutput> {
  if (!input.entry_id && !(input.event_id && input.customer_email)) {
    throw new NightlifeError(
      "INVALID_REQUEST",
      "Must provide either entry_id or event_id + customer_email",
    );
  }

  let entryData: any = null;

  if (input.entry_id) {
    const { data, error } = await supabase
      .from("event_guest_list_entries")
      .select("id, email, name, group_size, created_at, event_day_id, venue_id, service_date")
      .eq("id", input.entry_id)
      .maybeSingle();

    if (error) {
      throw new NightlifeError("DB_QUERY_FAILED", `Failed to look up entry: ${error.message}`);
    }
    entryData = data;
  } else if (input.event_id && input.customer_email) {
    // Resolve event_id to event_day_id(s)
    const { data: eventDays } = await supabase
      .from("event_occurrence_days")
      .select("id")
      .eq("event_occurrence_id", input.event_id);

    const dayIds = eventDays?.map((d: any) => d.id) ?? [];

    if (dayIds.length > 0) {
      const { data, error } = await supabase
        .from("event_guest_list_entries")
        .select("id, email, name, group_size, created_at, event_day_id, venue_id, service_date")
        .eq("email", input.customer_email.toLowerCase())
        .in("event_day_id", dayIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new NightlifeError("DB_QUERY_FAILED", `Failed to look up entry: ${error.message}`);
      }
      entryData = data;
    }
  }

  if (!entryData) {
    throw new NightlifeError(
      "GUEST_LIST_ENTRY_NOT_FOUND",
      "Guest list entry not found",
    );
  }

  // Get event name if we have event_day_id
  let eventName: string | null = null;
  let eventDate: string | null = entryData.service_date;

  if (entryData.event_day_id) {
    const { data: eventDay } = await supabase
      .from("event_occurrence_days")
      .select(`
        service_date,
        event_occurrences!inner (
          events!inner (
            name_en
          )
        )
      `)
      .eq("id", entryData.event_day_id)
      .maybeSingle();

    if (eventDay) {
      eventName = (eventDay as any).event_occurrences?.events?.name_en ?? null;
      eventDate = eventDay.service_date;
    }
  }

  // Get guest list settings for benefit/instructions
  const settings = await loadGuestListSettings(
    supabase,
    entryData.event_day_id,
    entryData.venue_id,
  );

  return {
    entry_id: entryData.id,
    status: "confirmed",
    customer_name: entryData.name,
    party_size: entryData.group_size,
    event_name: eventName,
    event_date: eventDate,
    created_at: entryData.created_at,
    guest_list_benefit: settings?.benefit_en ?? null,
    door_instructions: settings?.door_instructions_en ?? null,
  };
}
