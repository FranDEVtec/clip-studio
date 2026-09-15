// Cobro de la instalación asistida.
//
// Con PAY_URL, redirige a ese link fijo. Con MP_ACCESS_TOKEN, crea una
// preferencia de Checkout Pro en Mercado Pago (una por click, con el precio de
// PAY_PRICE/PAY_CURRENCY) y redirige al checkout. El token nunca sale del server.
import { NextResponse } from "next/server";
import { BRAND_NAME, CONTACT_URL, PAY_CURRENCY, PAY_PRICE, PAY_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (PAY_URL) return NextResponse.redirect(PAY_URL, 302);
  const token = process.env.MP_ACCESS_TOKEN;
  const origin = new URL(request.url).origin;
  if (!token || !(PAY_PRICE > 0)) return NextResponse.redirect(CONTACT_URL, 302);
  try {
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: [{ id: "instalacion-asistida", title: `${BRAND_NAME} · instalación asistida`, quantity: 1, unit_price: PAY_PRICE, currency_id: PAY_CURRENCY }],
        back_urls: { success: `${origin}/gracias?estado=ok`, pending: `${origin}/gracias?estado=pendiente`, failure: `${origin}/gracias?estado=fallo` },
        auto_return: "approved",
        statement_descriptor: BRAND_NAME.slice(0, 22),
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const pref = (await res.json()) as { init_point?: string };
    if (!pref.init_point) throw new Error("Mercado Pago no devolvió init_point");
    return NextResponse.redirect(pref.init_point, 302);
  } catch (err) {
    console.error("[pay]", err);
    return NextResponse.redirect(`${origin}/gracias?estado=error`, 302);
  }
}
