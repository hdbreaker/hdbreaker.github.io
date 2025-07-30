---
layout: ../layouts/Layout.astro
title: RSS Feed
description: Latest posts from Alejandro Parodi
---

<div class="container mx-auto px-4 py-8">
    <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold text-[#F5F5F5] mb-8">Latest Posts</h1>
        
        <!-- RSS.app Widget -->
        <div class="bg-[#1A1A1A] rounded-lg p-6 border border-[#57FD6B]/20">
            <rssapp-wall id="9w5ndFrgFmYTGYEi"></rssapp-wall>
            <script src="https://widget.rss.app/v1/wall.js" type="text/javascript" async></script>
        </div>
        
        <div class="mt-8 text-center">
            <p class="text-[#A0A0A0] text-sm">
                Follow me on <a href="https://x.com/hdbreaker_" target="_blank" class="text-[#57FD6B] hover:underline">Twitter @hdbreaker_</a> for real-time updates
            </p>
        </div>
    </div>
</div> 