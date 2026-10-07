# Optional: a small production image instead of running from source.
#   docker build -t whatsapp-bot .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/WhatsAppBot/WhatsAppBot.csproj src/WhatsAppBot/
RUN dotnet restore src/WhatsAppBot/WhatsAppBot.csproj
COPY src/ src/
RUN dotnet publish src/WhatsAppBot -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV DATA_DIR=/data PORT=3000
EXPOSE 3000
ENTRYPOINT ["dotnet", "WhatsAppBot.dll"]
