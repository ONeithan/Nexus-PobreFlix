using System;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Jellyfin.Plugin.JMSFusion.Controllers;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    public sealed class PathRewriteMiddleware
    {
        private readonly RequestDelegate _next;
        private static readonly Regex ItemPrimaryImageRegex = new(
            @"^/(?:web/)?Items/([0-9a-fA-F-]{32,36})/Images/Primary",
            RegexOptions.Compiled | RegexOptions.IgnoreCase
        );

        public PathRewriteMiddleware(RequestDelegate next) => _next = next;

        public async Task InvokeAsync(HttpContext ctx)
        {
            var path = ctx.Request.Path;

            if (path.HasValue)
            {
                if (path.StartsWithSegments("/web/slider", out var remaining))
                {
                    ctx.Request.Path = new PathString("/slider" + remaining);
                }
                else
                {
                    var match = ItemPrimaryImageRegex.Match(path.Value!);
                    if (match.Success)
                    {
                        var rawId = match.Groups[1].Value.Replace("-", "");
                        if (ImageLockController.IsLocked(rawId))
                        {
                            ctx.Request.Path = new PathString($"/Plugins/JMSFusion/Images/Serve/{rawId}");
                        }
                    }
                }
            }

            await _next(ctx);
        }
    }
}
