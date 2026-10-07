using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WhatsAppBot;

/// <summary>
/// Coexistence signup: connects a WhatsApp Business app number to this bot through
/// Meta's Embedded Signup popup, while the number keeps working in the app.
/// </summary>
public sealed class Signup(GraphClient graph, WhatsAppAccount account, BotSettings settings, ILogger<Signup> log)
{
    public record CompleteRequest(
        [property: JsonPropertyName("code")] string Code,
        [property: JsonPropertyName("waba_id")] string WabaId,
        [property: JsonPropertyName("phone_number_id")] string PhoneNumberId);

    public string Page() =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "signup.html"))
            .Replace("{{APP_ID}}", settings.AppId)
            .Replace("{{CONFIG_ID}}", settings.EmbeddedSignupConfigId)
            .Replace("{{GRAPH_VERSION}}", GraphClient.Version);

    public async Task<string> CompleteAsync(CompleteRequest req)
    {
        // 1. Swap the one-time code for a long-lived business token.
        var query = $"client_id={Uri.EscapeDataString(settings.AppId)}" +
                    $"&client_secret={Uri.EscapeDataString(settings.AppSecret)}" +
                    $"&code={Uri.EscapeDataString(req.Code)}";
        var tokenResponse = await graph.GetAsync($"oauth/access_token?{query}");
        var token = (string?)tokenResponse?["access_token"]
                    ?? throw new InvalidOperationException($"Token exchange failed: {tokenResponse}");

        // 2. Let this app receive the account's webhooks. No /register call: the number
        //    is already registered by the Business app, which keeps working.
        await graph.PostAsync($"{req.WabaId}/subscribed_apps", token);

        // 3. Save and start using it right away.
        account.Connect(token, req.WabaId, req.PhoneNumberId);

        // 4. Sync contacts, then chat history (Meta allows this within 24h of connecting).
        foreach (var syncType in new[] { "smb_app_state_sync", "history" })
        {
            try
            {
                await graph.PostAsync($"{req.PhoneNumberId}/smb_app_data", token,
                    new JsonObject { ["messaging_product"] = "whatsapp", ["sync_type"] = syncType });
                log.LogInformation("Requested {SyncType}", syncType);
            }
            catch (Exception e)
            {
                log.LogError("{Error}", e.Message);
            }
        }

        return $"Connected! The bot now answers on phone number ID {req.PhoneNumberId}.\n" +
               "Set SIGNUP_ENABLED back to 0 and restart the app.";
    }
}
