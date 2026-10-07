using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace WhatsAppBot;

/// <summary>Thin wrapper over Meta's Graph API.</summary>
public sealed class GraphClient(HttpClient http, WhatsAppAccount account, ILogger<GraphClient> log)
{
    public const string Version = "v25.0";

    public async Task SendAsync(string to, string type, object content)
    {
        var payload = new Dictionary<string, object>
        {
            ["messaging_product"] = "whatsapp",
            ["to"] = to,
            ["type"] = type,
            [type] = content,
        };
        try
        {
            await PostAsync($"{account.PhoneNumberId}/messages", account.Token, payload);
            log.LogInformation("Sent {Type} to {To}", type, to);
        }
        catch (Exception e)
        {
            log.LogError("Send failed {Error}", e.Message);
        }
    }

    public Task SendTextAsync(string to, string text) => SendAsync(to, "text", new { body = text });

    public Task SendInteractiveAsync(string to, object interactive) => SendAsync(to, "interactive", interactive);

    public async Task<JsonNode?> PostAsync(string path, string token, object? body = null)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = body is null ? null : JsonContent.Create(body),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await ReadAsync(await http.SendAsync(req), $"POST {path}");
    }

    public async Task<JsonNode?> GetAsync(string pathAndQuery) =>
        await ReadAsync(await http.GetAsync(pathAndQuery), $"GET {pathAndQuery.Split('?')[0]}");

    private static async Task<JsonNode?> ReadAsync(HttpResponseMessage res, string what)
    {
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{what} failed {(int)res.StatusCode}: {text}");
        return string.IsNullOrEmpty(text) ? null : JsonNode.Parse(text);
    }
}
