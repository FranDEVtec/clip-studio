import { redirect } from "next/navigation";

// La home es el calendario.
export default function Home() {
  redirect("/calendario");
}
