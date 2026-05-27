import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

function getApiCookie(env?: Env) {
	return env?.API_COOKIE || process.env.API_COOKIE || "";
}

type SearchResultBase = {
	product: "package_search";
	name: string;
	names: string[];
	sg_id: number;
	user_searchable: boolean;
	sgh_codes: string;
	tti_place_key: string;
	specificity: number;
	rank: number;
};

type PlaceResult = SearchResultBase & {
	source: "pkgdest";
	kind: "place";
};

type AccommodationResult = SearchResultBase & {
	source: "pkgaccom";
	kind: "accommodation";
	tti_code: number;
};

type TravelResult =
	| {
			type: "destination";
			id: string;
			name: string;
			parent?: string;
			country?: string;
			sgh_codes: string;
			tti_place_key: string;
	  }
	| {
			type: "hotel";
			id: string;
			name: string;
			destinationId?: string;
			destinationName?: string;
	  };

type HasSghCodes = { sgh_codes: string };

function isInDestination(item: HasSghCodes, destinationId: number): boolean {
	return (item.sgh_codes ?? "")
		.split("-")
		.includes(String(destinationId));
}

function mapDestination(d: PlaceResult): TravelResult {
	return {
		type: "destination",
		id: String(d.sg_id),
		name: d.name,
		parent: d.names?.[1],
		country: d.names?.[2],
		sgh_codes: d.sgh_codes,
		tti_place_key: d.tti_place_key,
	};
}

function mapHotel(h: AccommodationResult): TravelResult {
	// derive destination id safely from sg_id chain if needed
	const destinationId = h.sgh_codes?.split("-")?.[1];

	return {
		type: "hotel",
		id: String(h.tti_code),
		name: h.name,
		destinationId,
		destinationName: h.names?.[1],
	};
}

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Destination and Hotel Info Agent",
		version: "1.0.0",
		description:
			"Provides travel destinations and hotel information with relationships between them, such as country level down to city and resort level.",
	});

	async init() {
		this.server.registerTool(
			"destination_info_search",
			{ inputSchema: { query: z.string() } },
			async ({ query }) => {

const cookie = getApiCookie(this.env);

console.error("API_COOKIE exists:", !!cookie);
console.error("API_COOKIE length:", cookie.length);

				const url = new URL(
					"https://api.icelolly.com/universal-autocomplete/v1/suggest"
				);

				url.searchParams.set("products", "package_search,city_search");
				url.searchParams.set("limit", "10");
				url.searchParams.set("query", query);
				url.searchParams.set("group[destinations]", "place,landmark");
				url.searchParams.set("group[hotels]", "accommodation");

				const res = await fetch(url, {
					headers: {
						"User-Agent": "destinations-mcp/1.0",
						Accept: "application/json",
						cookie: cookie,
					},
				});

				if (!res.ok) {
					return {
						content: [
							{
								type: "text",
								text: `API error: ${res.status}`,
							},
						],
					};
				}

				const json: {
					destinations?: PlaceResult[];
					hotels?: AccommodationResult[];
				} = await res.json();

				console.log("🌈API resp", JSON.stringify(json, null, 2));

				const destinations = json.destinations ?? [];
				const hotels = json.hotels ?? [];

				const destinationMatch = destinations.find(
					(d) => d.name.toLowerCase() === query.toLowerCase()
				);

				const selectedDestinationId = destinationMatch?.sg_id;

				let results: TravelResult[] = [
					...destinations.map(mapDestination),
					...hotels.map(mapHotel),
				];


				if (selectedDestinationId) {
	const filteredDestinations = destinations.filter((d) =>
		isInDestination(d, selectedDestinationId) ||
		d.sg_id === selectedDestinationId
	);

	const filteredHotels = hotels.filter((h) =>
		isInDestination(h, selectedDestinationId)
	);

	results = [
		...filteredDestinations.map(mapDestination),
		...filteredHotels.map(mapHotel),
	];
} else {
	results = [
		...destinations.map(mapDestination),
		...hotels.map(mapHotel),
	];
}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(results, null, 2),
						},
					],
				};
			}
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};