import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createProxyClient } from "@/utils/supabase-proxy";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isOfficeRoute = pathname.startsWith("/office");

  if (!isDashboardRoute && !isOfficeRoute) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });
  const supabase = createProxyClient(request, response);

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claims?.claims?.sub) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", claims.claims.sub)
      .single();

    if (!profile) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    if (isDashboardRoute && profile.role !== "practitioner") {
      return NextResponse.redirect(new URL("/office", request.url));
    }

    if (isOfficeRoute && profile.role === "practitioner") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } catch (err) {
    console.error("Proxy authorization boundary error:", err);
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/office/:path*"],
};
