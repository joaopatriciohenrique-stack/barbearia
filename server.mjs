import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const host = process.env.HOST;
const port = Number(process.env.PORT);

if (!host) throw new Error("HOST is required");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535");

const services = Object.freeze([
  { id: "corte", name: "Corte masculino", duration: 40, priceCents: 4000, description: "Tesoura, máquina e acabamento preciso." },
  { id: "combo", name: "Corte + barba", duration: 60, priceCents: 6000, description: "Experiência completa, do fio ao contorno." },
  { id: "barba", name: "Barba", duration: 30, priceCents: 3000, description: "Desenho, toalha quente e finalização." },
]);

const serviceById = new Map(services.map((service) => [service.id, service]));
const clientRoot = fileURLToPath(new URL("./dist/", import.meta.url));
const clientRootPrefix = clientRoot.endsWith(sep) ? clientRoot : `${clientRoot}${sep}`;
const indexPath = resolve(clientRoot, "index.html");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".gif", "image/gif"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"],
  [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

const SAFE_DATABASE_CODE = /^[A-Z0-9_]{1,32}$/;
const SAFE_OPERATIONS = new Set(["list_slots", "create_booking", "create_notification", "lookup_bookings", "cancel_booking"]);
const rateLimits = new Map();
let supabaseClient;

class DatabaseUnavailableError extends Error {
  constructor() { super("Database unavailable"); this.code = "DATABASE_UNAVAILABLE"; }
}

class DatabaseOperationError extends Error {
  constructor(rawError, operation) {
    super("Database operation failed");
    this.code = "DATABASE_OPERATION_FAILED";
    const code = typeof rawError?.code === "string" && SAFE_DATABASE_CODE.test(rawError.code.toUpperCase()) ? rawError.code.toUpperCase() : "UNKNOWN";
    const status = Number.isInteger(Number(rawError?.status)) ? Number(rawError.status) : undefined;
    this.diagnostic = Object.freeze({
      category: status === 403 || code === "42501" ? "permission_denied" : code === "23505" ? "conflict" : code === "42P01" || code === "PGRST205" ? "schema_mismatch" : status === 429 ? "rate_limited" : status >= 500 ? "upstream_unavailable" : "operation_failed",
      code,
      operation: SAFE_OPERATIONS.has(operation) ? operation : "unknown",
      ...(status ? { status } : {}),
    });
  }
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const legacy = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    instanceId: process.env.SUPABASE_INSTANCE_ID,
  };
  const count = Object.values(legacy).filter(Boolean).length;
  if (count !== 0 && count !== 3) throw new DatabaseUnavailableError();
  const external = count === 3;
  supabaseClient = createClient(external ? legacy.url : "http://127.0.0.1:9001", external ? legacy.key : "qwenwork-runtime-broker", {
    global: { headers: external ? { "X-Instance-ID": legacy.instanceId } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

async function runDatabaseOperation(operation, execute) {
  try {
    const { data, error } = await execute();
    if (error) throw new DatabaseOperationError(error, operation);
    return data;
  } catch (error) {
    if (error instanceof DatabaseOperationError || error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseOperationError(error, operation);
  }
}

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "x-content-type-options": "nosniff", "cache-control": "no-store" });
  response.end(typeof body === "string" || Buffer.isBuffer(body) || body === undefined ? body : JSON.stringify(body));
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, maxLength) : "";
}

function normalizePhone(value) {
  const phone = String(value ?? "").replace(/\D/g, "");
  return phone.length >= 10 && phone.length <= 13 ? phone : "";
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= localToday() && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function allSlots() {
  const result = [];
  for (const [start, end] of [[9 * 60, 12 * 60], [13 * 60, 19 * 60]]) {
    for (let minutes = start; minutes < end; minutes += 30) {
      result.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
    }
  }
  return result;
}

function bookingView(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    serviceName: row.service_name,
    appointmentDate: row.appointment_date,
    appointmentTime: String(row.appointment_time).slice(0, 5),
    priceCents: row.price_cents,
    notes: row.notes,
    status: row.status,
  };
}

function formattedDate(date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" }).format(new Date(`${date}T12:00:00Z`));
}

function confirmationMessage(booking, cancelled = false) {
  if (cancelled) return `Olá, ${booking.customerName}. Seu agendamento de ${booking.serviceName}, em ${formattedDate(booking.appointmentDate)}, às ${booking.appointmentTime}, foi cancelado.`;
  return `Olá, ${booking.customerName}. Seu agendamento na Barbearia Emanuel Sousa está confirmado: ${booking.serviceName}, ${formattedDate(booking.appointmentDate)}, às ${booking.appointmentTime}.`;
}

function notificationReceipt(message, cancelled = false) {
  return {
    title: cancelled ? "Cancelamento registrado" : "Horário reservado!",
    message,
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
  };
}

async function recordNotification(booking, cancelled = false) {
  const message = confirmationMessage(booking, cancelled);
  await runDatabaseOperation("create_notification", () => getSupabaseClient().from("notification_events").insert({
    booking_id: booking.id,
    event_type: cancelled ? "booking_cancelled" : "booking_confirmed",
    message,
  }));
  return notificationReceipt(message, cancelled);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

function limited(request, action, maximum = 16) {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const address = forwarded || request.socket.remoteAddress || "unknown";
  const key = `${action}:${address}`;
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || now - current.startedAt > 60_000) {
    rateLimits.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  return current.count > maximum;
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health" && request.method === "GET") return send(response, 200, { status: "ok" });
  if (url.pathname === "/api/services" && request.method === "GET") return send(response, 200, { services });

  if (url.pathname === "/api/slots" && request.method === "GET") {
    const date = url.searchParams.get("date");
    if (!validDate(date)) return send(response, 400, { error: "invalid_booking" });
    const rows = await runDatabaseOperation("list_slots", () => getSupabaseClient().from("bookings").select("appointment_time").eq("appointment_date", date).neq("status", "cancelled"));
    const busy = new Set(rows.map((row) => String(row.appointment_time).slice(0, 5)));
    return send(response, 200, { slots: allSlots().map((time) => ({ time, available: !busy.has(time) })) });
  }

  if (url.pathname === "/api/bookings" && request.method === "POST") {
    if (limited(request, "create", 8)) return send(response, 429, { error: "too_many_requests" });
    const body = await readJson(request);
    const service = serviceById.get(body.serviceId);
    const phone = normalizePhone(body.phone);
    const name = cleanText(body.name, 100);
    const notes = cleanText(body.notes, 500);
    if (!service || !phone || name.length < 2 || !validDate(body.date) || !allSlots().includes(body.time)) return send(response, 400, { error: "invalid_booking" });
    const row = await runDatabaseOperation("create_booking", () => getSupabaseClient().from("bookings").insert({
      customer_name: name,
      phone,
      service_id: service.id,
      service_name: service.name,
      appointment_date: body.date,
      appointment_time: body.time,
      price_cents: service.priceCents,
      notes,
      status: "confirmed",
    }).select("id, customer_name, phone, service_name, appointment_date, appointment_time, price_cents, notes, status").single());
    const booking = bookingView(row);
    const notification = await recordNotification(booking);
    return send(response, 201, { booking, notification });
  }

  if (url.pathname === "/api/bookings/lookup" && request.method === "POST") {
    if (limited(request, "lookup")) return send(response, 429, { error: "too_many_requests" });
    const body = await readJson(request);
    const phone = normalizePhone(body.phone);
    if (!phone) return send(response, 400, { error: "invalid_phone" });
    const rows = await runDatabaseOperation("lookup_bookings", () => getSupabaseClient().from("bookings").select("id, customer_name, phone, service_name, appointment_date, appointment_time, price_cents, notes, status").eq("phone", phone).order("appointment_date", { ascending: false }).order("appointment_time", { ascending: false }).limit(30));
    const bookings = rows.map(bookingView);
    return send(response, 200, { contact: bookings.length ? { name: bookings[0].customerName, phone } : null, bookings });
  }

  const cancelMatch = url.pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})\/cancel$/i);
  if (cancelMatch && request.method === "POST") {
    if (limited(request, "cancel", 8)) return send(response, 429, { error: "too_many_requests" });
    const body = await readJson(request);
    const phone = normalizePhone(body.phone);
    if (!phone) return send(response, 400, { error: "invalid_phone" });
    const row = await runDatabaseOperation("cancel_booking", () => getSupabaseClient().from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", cancelMatch[1]).eq("phone", phone).eq("status", "confirmed").gte("appointment_date", localToday()).select("id, customer_name, phone, service_name, appointment_date, appointment_time, price_cents, notes, status").maybeSingle());
    if (!row) return send(response, 404, { error: "booking_not_found" });
    const booking = bookingView(row);
    const notification = await recordNotification(booking, true);
    return send(response, 200, { booking, notification });
  }

  return send(response, 404, { error: "not_found" });
}

function isInsideClientRoot(path) { return path === clientRoot || path.startsWith(clientRootPrefix); }

async function existingFile(path) {
  try { const details = await stat(path); return details.isFile() ? path : null; }
  catch (error) { if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null; throw error; }
}

async function resolveClientFile(pathname) {
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); } catch { return null; }
  const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const candidate = resolve(clientRoot, relativePath);
  if (!isInsideClientRoot(candidate)) return null;
  return await existingFile(candidate) || (extname(decodedPath) ? null : existingFile(indexPath));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://qwenwork.local");
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      return send(response, 405, "Method Not Allowed", "text/plain; charset=utf-8");
    }
    const file = await resolveClientFile(url.pathname);
    if (!file) return send(response, 404, "Not Found", "text/plain; charset=utf-8");
    const body = request.method === "HEAD" ? undefined : await readFile(file);
    return send(response, 200, body, contentTypes.get(extname(file).toLowerCase()) ?? "application/octet-stream");
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return send(response, 503, { error: "database_unavailable" });
    if (error instanceof DatabaseOperationError) {
      const traceId = crypto.randomUUID();
      console.error(`Database failure traceId=${traceId} category=${error.diagnostic.category} code=${error.diagnostic.code} operation=${error.diagnostic.operation}${error.diagnostic.status ? ` status=${error.diagnostic.status}` : ""}`);
      return send(response, error.diagnostic.category === "conflict" ? 409 : 503, { error: error.diagnostic.category === "conflict" ? "slot_unavailable" : "database_unavailable", traceId });
    }
    const status = Number(error?.status);
    if (status === 400 || status === 413) return send(response, status, { error: "invalid_request" });
    console.error(`Request failure type=${error?.name === "TypeError" ? "TypeError" : "unknown"}`);
    return send(response, 500, { error: "internal_error" });
  }
});

server.listen(port, host, () => console.log(`QW Page server listening on http://${host}:${port}`));
