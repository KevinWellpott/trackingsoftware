import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublishableKey } from "@/lib/supabase/publishable-key";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims statt getUser: Das Projekt signiert mit einem asymmetrischen
  // Schlüssel (ES256), die Signatur wird deshalb lokal gegen den gecachten
  // JWKS geprüft — kein Roundtrip zum Auth-Server je Anfrage. Ein abgelaufenes
  // Token frischt getClaims über getSession() auf und schreibt die Cookies
  // wie bisher über setAll. Preis: Ein serverseitig widerrufenes Token gilt
  // bis zu seinem Ablauf (Standard 1 h) weiter; das Entfernen der
  // Mitgliedschaft sperrt trotzdem sofort, weil getAccessContext sie liest.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;

  // /api/ ist hier bewusst offen: API-Routen antworten mit 401 statt mit einem
  // Redirect auf /login. Der Preis ist, dass jede neue Route unter /api/ ihre
  // Authentifizierung SELBST machen muss (Vorbild: /api/export ruft
  // getAccessContext() und gibt sonst 401 zurueck). Wer das vergisst, baut
  // einen oeffentlichen Endpunkt — genau so entstanden die geloeschten
  // /api/setup, /api/add-daniel und /api/add-samuel.
  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/api/");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
