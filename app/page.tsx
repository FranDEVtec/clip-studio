import { redirect } from "next/navigation";
import { LANDING_MODE } from "@/lib/config";
import { Landing } from "@/components/landing";

// Con LANDING_MODE=1 (el deploy de quien comparte el proyecto) la raíz es la
// landing pública. En la copia de cada creador, la raíz es la app.
export default function Home() {
  if (!LANDING_MODE) redirect("/app");
  return <Landing />;
}
