import { resolveMapsUrl } from "@/lib/urls";

export function MapButton({
  mapUrl,
  name,
  address,
}: {
  mapUrl?: string;
  name: string;
  address?: string;
}) {
  return (
    <a
      className="btn w-full sm:w-auto"
      href={resolveMapsUrl(mapUrl, name, address)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${name} in Maps (opens in a new tab)`}
    >
      Open in Maps
    </a>
  );
}
