<script lang="ts">
    let lectures: any[] = [];

    async function loadLectures() {
        const response =
            await fetch("/api/lectures");

        lectures =
            await response.json();
    }
</script>

<button
    class="border px-4 py-2"
    onclick={loadLectures}
>
    Load Lectures
</button>

<ul>
    {#each lectures as lecture}
        <li>{lecture.title}</li>
    {/each}
</ul>
