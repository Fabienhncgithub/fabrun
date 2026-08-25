FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS build
WORKDIR /src

COPY FabRun.Api.csproj ./
RUN dotnet restore FabRun.Api.csproj

COPY . ./
RUN dotnet publish FabRun.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0.11 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./
RUN mkdir -p /app/Data /home/app/.aspnet/DataProtection-Keys \
    && chown -R $APP_UID:$APP_UID /app/Data /home/app/.aspnet \
    && chmod 700 /app/Data /home/app/.aspnet /home/app/.aspnet/DataProtection-Keys

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "FabRun.Api.dll"]
