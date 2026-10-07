using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using WhatsAppBot;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; });
builder.Logging.AddFilter("Microsoft", LogLevel.Warning).AddFilter("System.Net.Http", LogLevel.Warning);
builder.WebHost.UseUrls($"http://0.0.0.0:{builder.Configuration["PORT"] ?? "3000"}");

var settings = BotSettings.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<WhatsAppAccount>();
builder.Services.AddSingleton<Bot>();
builder.Services.AddSingleton<Signup>();
builder.Services.AddHttpClient<GraphClient>(http =>
    http.BaseAddress = new Uri((builder.Configuration["GRAPH_URL"] ?? $"https://graph.facebook.com/{GraphClient.Version}").TrimEnd('/') + "/"));

// Webhooks are answered right away and handled in the background, as Meta expects.
var queue = Channel.CreateUnbounded<JsonNode>();
builder.Services.AddSingleton(queue);
builder.Services.AddHostedService<WebhookWorker>();

var app = builder.Build();

app.MapGet("/", () => "WhatsApp bot is running");

// Meta checks the webhook once with a GET when you click "Verify and save".
app.MapGet("/webhook", (HttpRequest req) =>
    req.Query["hub.mode"] == "subscribe" && req.Query["hub.verify_token"] == settings.VerifyToken
        ? Results.Text(req.Query["hub.challenge"])
        : Results.StatusCode(403));

// Incoming messages, button taps and app echoes arrive as POSTs.
app.MapPost("/webhook", async (HttpRequest req, ILogger<Program> log) =>
{
    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);
    var raw = ms.ToArray();

    if (!ValidSignature(raw, req.Headers["X-Hub-Signature-256"]))
    {
        log.LogWarning("Rejected request with bad signature");
        return Results.StatusCode(401);
    }
    try
    {
        if (JsonNode.Parse(raw) is { } body) queue.Writer.TryWrite(body);
    }
    catch (JsonException) { }
    return Results.Ok();
});

if (settings.SignupEnabled)
{
    app.MapGet("/signup", (Signup signup) => Results.Content(signup.Page(), "text/html; charset=utf-8"));
    app.MapPost("/signup/complete", async (Signup.CompleteRequest body, Signup signup, ILogger<Program> log) =>
    {
        try
        {
            return Results.Text(await signup.CompleteAsync(body));
        }
        catch (Exception e)
        {
            log.LogError("{Error}", e.Message);
            return Results.Text("Something went wrong: " + e.Message, statusCode: 500);
        }
    });
}

app.Run();

bool ValidSignature(byte[] raw, string? header)
{
    if (settings.AppSecret == "") return true;
    if (header is null) return false;
    var expected = "sha256=" + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(settings.AppSecret), raw));
    return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(header), Encoding.UTF8.GetBytes(expected));
}

sealed class WebhookWorker(Channel<JsonNode> queue, Bot bot, ILogger<WebhookWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await foreach (var body in queue.Reader.ReadAllAsync(stop))
        {
            try { await bot.HandleWebhookAsync(body); }
            catch (Exception e) { log.LogError(e, "Handler error"); }
        }
    }
}
