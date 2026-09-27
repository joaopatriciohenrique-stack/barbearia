import { FormEvent, useEffect, useMemo, useState } from "react";

type Service = {
  id: string;
  name: string;
  duration: number;
  priceCents: number;
  description: string;
};

type Slot = { time: string; available: boolean };

type Booking = {
  id: string;
  customerName: string;
  phone: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  priceCents: number;
  notes: string;
  status: "confirmed" | "cancelled" | "completed";
};

type BookingDraft = {
  serviceId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  notes: string;
};

type Receipt = {
  title: string;
  message: string;
  whatsappUrl: string;
};

const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const initialDraft = (): BookingDraft => ({
  serviceId: "",
  date: today(),
  time: "",
  name: "",
  phone: "",
  notes: "",
});

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

const phoneMask = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const messages: Record<string, string> = {
      invalid_phone: "Informe um celular válido com DDD.",
      invalid_booking: "Revise os dados do agendamento.",
      slot_unavailable: "Este horário acabou de ser ocupado. Escolha outro.",
      booking_not_found: "Não foi possível localizar esse agendamento.",
      database_unavailable: "A agenda está temporariamente indisponível. Tente novamente.",
      too_many_requests: "Muitas tentativas. Aguarde um instante e tente novamente.",
    };
    throw new Error(messages[payload.error ?? ""] ?? "Não foi possível concluir. Tente novamente.");
  }
  return payload;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div><span className="kicker">Emanuel Sousa</span><h2>{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function App() {
  const [services, setServices] = useState<Service[]>([]);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<BookingDraft>(initialDraft);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lookupPhone, setLookupPhone] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [contactName, setContactName] = useState("");
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    api<{ services: Service[] }>("/api/services")
      .then((result) => setServices(result.services))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (step !== 3 || !draft.date) return;
    setLoading(true);
    setError("");
    api<{ slots: Slot[] }>(`/api/slots?date=${encodeURIComponent(draft.date)}`)
      .then((result) => setSlots(result.slots))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [step, draft.date]);

  const service = useMemo(
    () => services.find((item) => item.id === draft.serviceId),
    [services, draft.serviceId],
  );

  const openBooking = () => {
    setDraft(initialDraft());
    setStep(1);
    setReceipt(null);
    setError("");
    setBookingOpen(true);
  };

  const next = () => {
    setError("");
    if (step === 1 && !draft.serviceId) return setError("Escolha um serviço.");
    if (step === 2 && !draft.date) return setError("Escolha uma data.");
    if (step === 3 && !draft.time) return setError("Escolha um horário livre.");
    if (step === 4) {
      if (draft.name.trim().length < 2) return setError("Informe seu nome.");
      if (draft.phone.replace(/\D/g, "").length < 10) return setError("Informe um celular válido com DDD.");
    }
    setStep((current) => Math.min(5, current + 1));
  };

  const createBooking = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ booking: Booking; notification: Receipt }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setReceipt(result.notification);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const lookup = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError("");
    setReceipt(null);
    try {
      const result = await api<{ contact: { name: string; phone: string } | null; bookings: Booking[] }>("/api/bookings/lookup", {
        method: "POST",
        body: JSON.stringify({ phone: lookupPhone }),
      });
      setBookings(result.bookings);
      setContactName(result.contact?.name ?? "");
      setSearched(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const cancelBooking = async (booking: Booking) => {
    const confirmed = window.confirm(`Cancelar ${booking.serviceName} em ${dateLabel(booking.appointmentDate)}, às ${booking.appointmentTime}?`);
    if (!confirmed) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ booking: Booking; notification: Receipt }>(`/api/bookings/${booking.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ phone: lookupPhone }),
      });
      setBookings((current) => current.map((item) => item.id === result.booking.id ? result.booking : item));
      setReceipt(result.notification);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Barbearia Emanuel Sousa">
          <img src="/logo.webp" alt="" />
          <span><b>Emanuel Sousa</b><small>Barbearia desde 2020</small></span>
        </a>
        <nav><a href="#servicos">Serviços</a><a href="#experiencia">Experiência</a></nav>
        <div className="top-actions"><button className="button ghost" onClick={() => { setClientOpen(true); setError(""); }}>Meu agendamento</button><button className="button dark" onClick={openBooking}>Agendar agora</button></div>
      </header>

      <main>
        <section className="hero" id="inicio">
          <div className="hero-copy">
            <span className="kicker">Agenda online · atendimento individual</span>
            <h1>Seu estilo.<br /><em>Seu horário.</em></h1>
            <p>Reserve a cadeira em poucos passos, guarde a confirmação e volte usando apenas o seu celular para consultar ou cancelar.</p>
            <div className="hero-actions"><button className="button accent" onClick={openBooking}>Escolher horário <span>→</span></button><button className="text-button" onClick={() => setClientOpen(true)}>Já tenho horário</button></div>
            <div className="proof"><span>✓</span> Confirmação clara <i /> <span>✓</span> Cancelamento online</div>
          </div>
          <div className="hero-art">
            <span className="orbit orbit-one" /><span className="orbit orbit-two" />
            <img src="/logo.webp" alt="Logomarca da Barbearia Emanuel Sousa" />
            <div className="availability"><small>Agenda digital</small><strong>Terça a sábado</strong><span>09h — 19h</span></div>
          </div>
        </section>

        <section className="services-section" id="servicos">
          <div className="section-heading"><div><span className="kicker light">Menu da cadeira</span><h2>Escolha o seu ritual.</h2></div><p>Horários reservados sem fila, com atenção inteira em cada acabamento.</p></div>
          <div className="service-grid">
            {services.map((item, index) => (
              <article className="service-card" key={item.id}>
                <span className="service-number">0{index + 1}</span>
                <div><h3>{item.name}</h3><p>{item.description}</p></div>
                <footer><span>{item.duration} min</span><strong>{money(item.priceCents)}</strong></footer>
              </article>
            ))}
          </div>
        </section>

        <section className="experience" id="experiencia">
          <div><span className="kicker">Seu retorno, simplificado</span><h2>O número do seu celular vira a chave da agenda.</h2></div>
          <div className="feature-list">
            <article><b>01</b><div><h3>Reserve</h3><p>Escolha serviço, data e uma vaga realmente disponível.</p></div></article>
            <article><b>02</b><div><h3>Consulte</h3><p>Digite o mesmo celular e veja seu contato e todos os horários.</p></div></article>
            <article><b>03</b><div><h3>Cancele</h3><p>Cancele um horário futuro e gere a mensagem de cancelamento.</p></div></article>
          </div>
        </section>
      </main>

      <footer className="footer"><span>Barbearia Emanuel Sousa</span><p>Estilo • Precisão • Confiança</p><small>Atendimento individual com hora marcada.</small></footer>

      {bookingOpen && (
        <Modal title={receipt ? "Agendamento confirmado" : "Agendar horário"} onClose={() => setBookingOpen(false)}>
          {receipt ? (
            <ReceiptView receipt={receipt} onDone={() => setBookingOpen(false)} />
          ) : (
            <div className="modal-body">
              <div className="progress" aria-label={`Passo ${step} de 5`}>{[1, 2, 3, 4, 5].map((item) => <span className={item <= step ? "active" : ""} key={item} />)}</div>
              {step === 1 && <Step title="O que vamos fazer?" label="1 · Serviço"><div className="choice-grid">{services.map((item) => <button className={`choice ${draft.serviceId === item.id ? "selected" : ""}`} onClick={() => setDraft({ ...draft, serviceId: item.id })} key={item.id}><strong>{item.name}</strong><small>{item.duration} minutos</small><b>{money(item.priceCents)}</b></button>)}</div></Step>}
              {step === 2 && <Step title="Qual é o melhor dia?" label="2 · Data"><label className="field"><span>Data do atendimento</span><input type="date" min={today()} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value, time: "" })} /></label></Step>}
              {step === 3 && <Step title="Escolha uma vaga livre." label="3 · Horário"><p className="step-note">{dateLabel(draft.date)} · {service?.name}</p><div className="slot-grid">{loading ? <p>Consultando agenda…</p> : slots.map((slot) => <button disabled={!slot.available} className={draft.time === slot.time ? "selected" : ""} onClick={() => setDraft({ ...draft, time: slot.time })} key={slot.time}>{slot.time}</button>)}</div></Step>}
              {step === 4 && <Step title="Como podemos confirmar?" label="4 · Contato"><div className="form-grid"><label className="field"><span>Seu nome</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nome completo" autoComplete="name" /></label><label className="field"><span>Celular com DDD</span><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: phoneMask(event.target.value) })} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" /></label><label className="field full"><span>Preferências do corte <small>(opcional)</small></span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Ex.: máquina 2 nas laterais…" /></label></div></Step>}
              {step === 5 && <Step title="Está tudo certo?" label="5 · Revisão"><div className="summary"><div><small>Serviço</small><strong>{service?.name}</strong></div><div><small>Valor</small><strong>{money(service?.priceCents ?? 0)}</strong></div><div><small>Data e hora</small><strong>{dateLabel(draft.date)} · {draft.time}</strong></div><div><small>Contato</small><strong>{draft.name}<br />{draft.phone}</strong></div></div></Step>}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-actions">{step > 1 ? <button className="button ghost" onClick={() => { setError(""); setStep(step - 1); }}>← Voltar</button> : <span />}{step < 5 ? <button className="button dark" onClick={next}>Continuar →</button> : <button className="button accent" onClick={createBooking} disabled={loading}>{loading ? "Confirmando…" : "Confirmar agendamento"}</button>}</div>
            </div>
          )}
        </Modal>
      )}

      {clientOpen && (
        <Modal title="Meu agendamento" onClose={() => setClientOpen(false)}>
          <div className="modal-body client-area">
            <p className="intro">Digite o mesmo número usado na reserva para visualizar seu contato e gerenciar horários.</p>
            <form className="lookup-form" onSubmit={lookup}><label className="field"><span>Celular com DDD</span><input value={lookupPhone} onChange={(event) => setLookupPhone(phoneMask(event.target.value))} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" /></label><button className="button dark" disabled={loading}>{loading ? "Consultando…" : "Consultar"}</button></form>
            {error && <p className="error" role="alert">{error}</p>}
            {contactName && <div className="contact-card"><span className="contact-avatar">{contactName.charAt(0).toUpperCase()}</span><div><small>Contato encontrado</small><strong>{contactName}</strong><p>{lookupPhone}</p></div><span className="verified">✓ verificado</span></div>}
            {receipt && <ReceiptView receipt={receipt} compact onDone={() => setReceipt(null)} />}
            <div className="booking-list">
              {bookings.map((booking) => <article className="booking-card" key={booking.id}><time><b>{new Date(`${booking.appointmentDate}T12:00:00`).getDate().toString().padStart(2, "0")}</b><span>{new Date(`${booking.appointmentDate}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" })}</span></time><div className="booking-info"><div className="booking-title"><h3>{booking.serviceName}</h3><span className={`status ${booking.status}`}>{booking.status === "confirmed" ? "Confirmado" : booking.status === "cancelled" ? "Cancelado" : "Concluído"}</span></div><p>{booking.appointmentTime} · {money(booking.priceCents)}</p>{booking.notes && <small>{booking.notes}</small>}</div>{booking.status === "confirmed" && booking.appointmentDate >= today() && <button className="cancel-button" onClick={() => cancelBooking(booking)} disabled={loading}>Cancelar</button>}</article>)}
              {searched && !bookings.length && <div className="empty-state"><span>○</span><h3>Nenhum agendamento encontrado</h3><p>Confira o número digitado ou faça uma nova reserva.</p><button className="button dark" onClick={() => { setClientOpen(false); openBooking(); }}>Agendar agora</button></div>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Step({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return <div className="step"><span className="step-label">Passo {label}</span><h3>{title}</h3>{children}</div>;
}

function ReceiptView({ receipt, onDone, compact = false }: { receipt: Receipt; onDone: () => void; compact?: boolean }) {
  return <div className={`receipt ${compact ? "compact" : ""}`}><div className="check">✓</div><div className="receipt-copy"><span className="step-label">Mensagem pronta</span><h3>{receipt.title}</h3><p>{receipt.message}</p><small>O WhatsApp abrirá com o texto preenchido; escolha a conversa e toque em enviar.</small></div><div className="receipt-actions"><a className="button whatsapp" href={receipt.whatsappUrl} target="_blank" rel="noreferrer">Abrir WhatsApp</a><button className="button ghost" onClick={onDone}>{compact ? "Fechar aviso" : "Concluir"}</button></div></div>;
}
