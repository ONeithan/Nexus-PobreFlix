using Microsoft.AspNetCore.Builder;

namespace Jellyfin.Plugin.NexusPobreFlix
{
    public static class MiddlewareExtensions
    {
        public static IApplicationBuilder UseNexusPobreFlix(this IApplicationBuilder app) => app;
    }
}
