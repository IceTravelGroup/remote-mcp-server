import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

function isInDestination(item: any, destinationId: string): boolean {
  const codes = (item.sgh_codes ?? '').split('-')
  return codes.includes(destinationId)
}

type TravelResult =
  | {
      type: 'destination'
      id: string
      name: string
      parent?: string
      country?: string
    }
  | {
      type: 'hotel'
      id: string
      name: string
      destinationId?: string
      destinationName?: string
    }

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Destination and Hotel Info Agent",
		version: "1.0.0",
		description: "Provides information about travel destinations and hotels, such as cities, regions and resorts within a country, and hotels within those destinations. It can also provide information about which hotels are located in a specific destination.",
	});

	async init() {
		this.server.registerTool(
			"destination_info_search",
			{ inputSchema: { query: z.string() } },
			async ({ query }) => {
				const url = new URL(
					"https://api.icelolly.com/universal-autocomplete/v1/suggest"
				);

				url.searchParams.set("products", "package_search,city_search");
				url.searchParams.set("limit", "10");
				url.searchParams.set("query", query);
				url.searchParams.set("group[destinations]", "place,landmark");
				url.searchParams.set("group[hotels]", "accommodation");

				let json: any;

					const res = await fetch(url, {
						headers: {
							"User-Agent": "destinations-mcp/1.0",
							Accept: "application/json",
							cookie: process.env.API_COOKIE ?? "",
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

					json = await res.json();

				const destinations = json.destinations ?? [];
				const hotels = json.hotels ?? [];

				const destinationMatch = destinations.find(
					(d: any) => d.name.toLowerCase() === query.toLowerCase()
				);

				const selectedDestinationId = destinationMatch?.sg_id;

				const typedDestinations = destinations.map((d: any) => ({
					type: "destination",
					id: String(d.sg_id),
					name: d.name,
					parent: d.names?.[1],
					country: d.names?.[2],
					sgh_codes: d.sgh_codes,
					tti_place_key: d.tti_place_key,
				}));

				let typedHotels = hotels.map((h: any) => ({
					type: "hotel",
					id: String(h.tti_code),
					name: h.name,
					destinationId: String(h.sg_id),
					destinationName: h.names?.[1],
				}));

				if (selectedDestinationId) {
					typedHotels = typedHotels.filter((h: any) =>
						isInDestination(h, selectedDestinationId)
					);

					const filteredDestinations = typedDestinations.filter(
						(d: any) =>
							isInDestination(d, selectedDestinationId) ||
							d.id === String(selectedDestinationId)
					);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									[...filteredDestinations, ...typedHotels],
									null,
									2
								),
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								[...typedDestinations, ...typedHotels],
								null,
								2
							),
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
