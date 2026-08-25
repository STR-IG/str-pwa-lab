import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://str-ig.github.io",
  "http://localhost:8000",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://str-ig.github.io",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json(req, { error: "UNAUTHORIZED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json(req, { error: "SERVER_CONFIGURATION" }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.email) return json(req, { error: "UNAUTHORIZED" }, 401);

    const callerEmail = cleanEmail(user.email);
    const { data: adminRow, error: adminError } = await admin
      .from("committee_admins")
      .select("email")
      .eq("email", callerEmail)
      .eq("active", true)
      .maybeSingle();

    if (adminError) return json(req, { error: "AUTHORIZATION_CHECK_FAILED" }, 500);
    if (!adminRow) return json(req, { error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "list") {
      const { data, error } = await admin
        .from("private_access_allowlist")
        .select("email, display_name, employee_number, phone, active")
        .order("display_name", { ascending: true });

      if (error) return json(req, { error: "LIST_FAILED" }, 500);
      return json(req, { affiliates: data ?? [] });
    }

    if (action === "delete") {
      const targetEmail = cleanEmail(body?.email);
      if (!targetEmail || targetEmail.length > 320) {
        return json(req, { error: "INVALID_AFFILIATE" }, 400);
      }

      const { data: target, error: targetError } = await admin
        .from("private_access_allowlist")
        .select("email, display_name")
        .eq("email", targetEmail)
        .maybeSingle();

      if (targetError) return json(req, { error: "LOOKUP_FAILED" }, 500);
      if (!target) return json(req, { error: "AFFILIATE_NOT_FOUND" }, 404);

      const { data: deletedRows, error: deleteError } = await admin
        .from("private_access_allowlist")
        .delete()
        .eq("email", target.email)
        .select("email");

      if (deleteError) return json(req, { error: "DELETE_FAILED" }, 500);
      if (!Array.isArray(deletedRows) || deletedRows.length !== 1) {
        return json(req, { error: "DELETE_NOT_CONFIRMED" }, 409);
      }

      return json(req, {
        deleted: true,
        displayName: target.display_name || target.email,
      });
    }

    return json(req, { error: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error("Unexpected lab-manage-affiliates error", error);
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  }
});
