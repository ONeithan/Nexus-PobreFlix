using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Jellyfin.Plugin.NexusPobreFlix.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.NexusPobreFlix
{
    public sealed class NexusPobreFlixServiceRegistrator : IPluginServiceRegistrator
    {
        public void RegisterServices(IServiceCollection services, IServerApplicationHost applicationHost)
        {
            services.AddSingleton<TrailerAutomationService>();
            services.AddTransient<IStartupFilter, NexusPobreFlixStartupFilter>();
        }
    }
}
