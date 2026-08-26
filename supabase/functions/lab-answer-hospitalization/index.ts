import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://str-ig.github.io",
  "http://localhost:8000",
]);

const workShifts = new Set(["morning", "afternoon", "night-start", "night-previous", "rest"]);
const medicalStatuses = new Set(["hospitalized", "rest", "no-rest", "unknown"]);
const durations = new Set(["yes", "no", "unknown"]);

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:";
  } catch {
    return false;
  }
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://str-ig.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

function cleanEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isIsoDate(value: unknown): value is string {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function isTime(value: unknown): value is string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ""));
}

function secretKey() {
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernKeys) {
    try {
      const parsed = JSON.parse(modernKeys);
      if (parsed?.default) return String(parsed.default);
    } catch {
      // Use the legacy key below when the modern key set is unavailable or malformed.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

async function safetyIdentifier(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 64);
}

function extractOutputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json(req, { error: "UNAUTHORIZED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const adminKey = secretKey();
    const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!supabaseUrl || !adminKey || !openAiKey) return json(req, { error: "SERVER_CONFIGURATION" }, 500);

    const admin = createClient(supabaseUrl, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.id || !user.email) return json(req, { error: "UNAUTHORIZED" }, 401);

    const { data: accessRow, error: accessError } = await admin
      .from("private_access_allowlist")
      .select("email")
      .eq("email", cleanEmail(user.email))
      .eq("active", true)
      .maybeSingle();
    if (accessError) return json(req, { error: "AUTHORIZATION_CHECK_FAILED" }, 500);
    if (!accessRow) return json(req, { error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({}));
    const relationship = String(body?.relationship ?? "").trim().slice(0, 80);
    const duration = String(body?.duration ?? "");
    const admissionDate = String(body?.admissionDate ?? "");
    const admissionTime = String(body?.admissionTime ?? "");
    const workShift = String(body?.workShift ?? "");
    const medicalStatus = String(body?.medicalStatus ?? "");
    const dischargeDate = String(body?.dischargeDate ?? "");
    const restUntil = String(body?.restUntil ?? "");
    const leaveDays = Array.isArray(body?.leaveDays) ? body.leaveDays.map((value: unknown) => String(value)) : [];

    const validCore = relationship && durations.has(duration) && isIsoDate(admissionDate) && isTime(admissionTime) && workShifts.has(workShift) && medicalStatuses.has(medicalStatus);
    const validDays = leaveDays.length === 5 && leaveDays.every(isIsoDate) && new Set(leaveDays).size === 5 && leaveDays.every((day: string, index: number) => index === 0 || day > leaveDays[0]) && leaveDays.every((day: string) => day >= admissionDate);
    const validDischarge = !["rest", "no-rest"].includes(medicalStatus) || isIsoDate(dischargeDate);
    const validRest = medicalStatus !== "rest" || (isIsoDate(restUntil) && restUntil >= dischargeDate);
    if (!validCore || !validDays || !validDischarge || !validRest) return json(req, { error: "INVALID_QUESTIONNAIRE" }, 400);

    const facts = {
      relationship,
      duration,
      admissionDate,
      admissionTime,
      workShift,
      medicalStatus,
      dischargeDate: dischargeDate || null,
      restUntil: restUntil || null,
      leaveDays,
    };

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 900,
        safety_identifier: await safetyIdentifier(user.id),
        instructions: `Eres un asistente informativo de la sección sindical STR-IG. Analiza exclusivamente los datos estructurados de un cuestionario sobre permiso por hospitalización familiar en España. La referencia general es el artículo 37.3.b del Estatuto de los Trabajadores: cinco días por accidente o enfermedad graves, hospitalización o intervención quirúrgica sin hospitalización que precise reposo domiciliario, para las relaciones incluidas legalmente. No inventes convenio, sentencia, diagnóstico, horario ni documentación. Distingue entre ingreso hospitalario y reposo tras el alta. Ten en cuenta que el turno nocturno puede exigir revisión individual del momento en que comienza la jornada. No afirmes que la selección de días discontinuos es válida con certeza si falta respaldo normativo o convencional; indícalo como aspecto que debe confirmar STR-IG. Da una orientación clara, prudente y breve, nunca una garantía jurídica. Si faltan datos o hay una posible incompatibilidad temporal, usa el estado revision. Responde en español y no incluyas datos personales.`,
        input: JSON.stringify(facts),
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "hospitalization_guidance",
            strict: true,
            schema: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["compatible", "revision", "not_compatible"] },
                title: { type: "string" },
                summary: { type: "string" },
                reasons: { type: "array", items: { type: "string" } },
                recommendations: { type: "array", items: { type: "string" } },
              },
              required: ["status", "title", "summary", "reasons", "recommendations"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    const aiData = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error("OpenAI hospitalization guidance failed", aiResponse.status, aiData?.error?.code ?? "unknown");
      return json(req, { error: "AI_UNAVAILABLE" }, 502);
    }
    const outputText = extractOutputText(aiData);
    if (!outputText) return json(req, { error: "AI_EMPTY_RESPONSE" }, 502);

    const guidance = JSON.parse(outputText);
    return json(req, { guidance });
  } catch (error) {
    console.error("Unexpected lab-answer-hospitalization error", error instanceof Error ? error.message : "unknown");
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  }
});
