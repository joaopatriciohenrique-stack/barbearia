CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 2 AND 100),
  phone text NOT NULL CHECK (phone ~ '^[0-9]{10,13}$'),
  service_id text NOT NULL,
  service_name text NOT NULL,
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_unique
  ON bookings (appointment_date, appointment_time)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS bookings_phone_index
  ON bookings (phone, appointment_date DESC, appointment_time DESC);

CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('booking_confirmed', 'booking_cancelled')),
  channel text NOT NULL DEFAULT 'whatsapp',
  delivery_status text NOT NULL DEFAULT 'ready' CHECK (delivery_status IN ('ready', 'sent', 'failed')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_events_booking_index
  ON notification_events (booking_id, created_at DESC);
