using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Jellyfin.Plugin.JMSFusion.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.JMSFusion
{
    public sealed class JMSFusionServiceRegistrator : IPluginServiceRegistrator
    {
        public void RegisterServices(IServiceCollection services, IServerApplicationHost applicationHost)
        {
            services.AddSingleton<TrailerAutomationService>();
            services.AddSingleton<CinemaPreRollCacheService>();
            services.AddSingleton<ScopedCacheJsonService>();
            services.AddTransient<IStartupFilter, JMSStartupFilter>();
        }
    }
}
